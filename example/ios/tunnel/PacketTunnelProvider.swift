//
//  PacketTunnelProvider.swift
//  tunnel
//
//  This is the Network Extension target that runs in a separate process.
//  It receives the Xray JSON config via shared App Group UserDefaults,
//  sets up the TUN network settings, and calls into the Xray Go library.
//
//  ⚠️  Before this compiles you must:
//  1. Add Xray.xcframework to the "tunnel" target in Xcode
//     (Build Phases → Link Binary With Libraries).
//  2. Add a Bridging Header to the tunnel target that imports libxray.h:
//       #include "libxray.h"
//  3. Make sure the tunnel target has the App Group entitlement matching kAppGroup.
//

import NetworkExtension
import os.log

// MARK: - Constants (must match HybridNitroXrayCore.swift)
private let kAppGroup  = "group.com.xraycore.example"
private let kConfigKey = "xray_config_json"

// Encrypted config read shared with the app via a Keychain access group.
// Mirrors XrayKeychain in HybridNitroXrayCore.swift (the NE target can't link
// the library pod, so the read side is duplicated here).
private enum XrayKeychain {
    private static let accessGroupSuffix = "com.xraycore.example.shared"
    private static let account = "xray_config_json"
    private static let service = "com.xraycore.vpn"

    private static func resolveAccessGroup() -> String? {
        let probe: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: "xray_seed_probe",
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        var status = SecItemCopyMatching(probe as CFDictionary, &result)
        if status == errSecItemNotFound {
            var add = probe
            add.removeValue(forKey: kSecReturnAttributes as String)
            add.removeValue(forKey: kSecMatchLimit as String)
            add[kSecValueData as String] = Data()
            SecItemAdd(add as CFDictionary, nil)
            status = SecItemCopyMatching(probe as CFDictionary, &result)
        }
        guard status == errSecSuccess,
              let attrs = result as? [String: Any],
              let group = attrs[kSecAttrAccessGroup as String] as? String,
              let prefix = group.components(separatedBy: ".").first
        else { return nil }
        return "\(prefix).\(accessGroupSuffix)"
    }

    static func load() -> String? {
        guard let group = resolveAccessGroup() else { return nil }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: group,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

// MARK: - Logger
private let logger = Logger(subsystem: "com.xraycore.example.tunnel", category: "PacketTunnel")

class PacketTunnelProvider: NEPacketTunnelProvider {

    // MARK: - startTunnel

    override func startTunnel(options: [String: NSObject]?,
                              completionHandler: @escaping (Error?) -> Void) {
        logger.info("startTunnel called")

        // Config source priority: startVPNTunnel options (in-memory, most
        // direct) → encrypted Keychain (on-demand cold start) → App Group
        // (legacy fallback).
        var configJson: String? = options?["config"] as? String
        if configJson == nil {
            configJson = XrayKeychain.load()
            if configJson != nil { logger.info("Config loaded from Keychain.") }
        }
        if configJson == nil, let defaults = UserDefaults(suiteName: kAppGroup) {
            configJson = defaults.string(forKey: kConfigKey)
            if configJson != nil { logger.info("Config loaded from App Group (fallback).") }
        }

        guard let finalConfig = configJson, !finalConfig.isEmpty else {
            let err = NSError(domain: "XrayTunnel", code: -1,
                              userInfo: [NSLocalizedDescriptionKey: "No Xray config found in options or shared App Group"])
            logger.error("startTunnel: \(err.localizedDescription)")
            completionHandler(err)
            return
        }

        logger.info("startTunnel: config loaded (\(finalConfig.count) bytes)")

        // 2. Configure the virtual TUN interface settings
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "240.0.0.1")

        // IPv4 — route ALL traffic through the tunnel
        let ipv4 = NEIPv4Settings(addresses: ["198.18.0.1"], subnetMasks: ["255.255.0.0"])
        ipv4.includedRoutes = [NEIPv4Route.default()]
        settings.ipv4Settings = ipv4

        // IPv6 — optional but highly recommended for modern networks
        let ipv6 = NEIPv6Settings(addresses: ["fd6e:a81b:704f:1211::1"], networkPrefixLengths: [64])
        ipv6.includedRoutes = [NEIPv6Route.default()]
        settings.ipv6Settings = ipv6

        // DNS — derive from the Xray config's dns.servers (IP entries only;
        // drop things like "localhost" that aren't valid NEDNSSettings servers).
        // Falls back to a neutral default when the config specifies none.
        settings.dnsSettings = NEDNSSettings(servers: dnsServers(from: finalConfig))

        // MTU must be <= physical interface MTU to avoid fragmentation
        settings.mtu = 1500

        // 3. Apply the network settings
        setTunnelNetworkSettings(settings) { [weak self] error in
            guard let self = self else { return }

            if let error = error {
                logger.error("setTunnelNetworkSettings failed: \(error.localizedDescription)")
                completionHandler(error)
                return
            }

            // 4. Get the TUN file descriptor
            //    packetFlow.value(forKey: "socket.fileDescriptor") is the documented
            //    private-but-stable way to get the raw fd on iOS for passing to C/Go code.
            guard let tunFd = self.tunnelFileDescriptor() else {
                let err = NSError(domain: "XrayTunnel", code: -2,
                                  userInfo: [NSLocalizedDescriptionKey: "Failed to obtain TUN file descriptor"])
                logger.error("startTunnel: \(err.localizedDescription)")
                completionHandler(err)
                return
            }

            logger.info("startTunnel: TUN fd=\(tunFd)")

            // 5. olcrtc (optional): if the config carries an "olcrtc" client
            //    block, start it in the BACKGROUND — SOCKS-only, no TUN. It must
            //    NOT block startTunnel: olcrtc's WebRTC handshake + retries can
            //    take tens of seconds, and iOS kills the NE if the completion
            //    handler is delayed that long. xray dials its server through
            //    olcrtc via dialerProxy → 127.0.0.1:<port>; those dials just
            //    retry until olcrtc's SOCKS is up. Merged runtime ~57MB (tight).
            if let olcrtcBlock = self.olcrtcConfigJSON(from: finalConfig) {
                DispatchQueue.global().async {
                    logger.info("Starting olcrtc (SOCKS, background)…")
                    let rc = olcrtcBlock.withCString { StartOlcrtc(UnsafeMutablePointer(mutating: $0)) }
                    if rc == 0 {
                        logger.info("olcrtc ready (rss \(String(format: "%.1f", Double(CurrentRSSBytes())/1048576), privacy: .public) MB)")
                    } else {
                        logger.error("StartOlcrtc failed: \(rc) — proxy dials fail until olcrtc is up")
                    }
                }
            }

            // 6. Start Xray Core ——————————————————————————————————————————
            let result = finalConfig.withCString { ptr in
                StartXray(UnsafeMutablePointer(mutating: ptr), Int32(tunFd))
            }

            if result != 0 {
                let err = NSError(domain: "XrayTunnel", code: Int(result),
                                  userInfo: [NSLocalizedDescriptionKey: "StartXray returned error code \(result)"])
                logger.error("StartXray failed: \(result)")
                StopOlcrtc()
                completionHandler(err)
            } else {
                logger.info("Xray started successfully")
                completionHandler(nil)
            }
        }
    }

    /// Extract the olcrtc client params (top-level "olcrtc" object) from the
    /// xray config JSON as a JSON string for StartOlcrtc, or nil if absent.
    private func olcrtcConfigJSON(from config: String) -> String? {
        guard
            let data = config.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let olcrtc = obj["olcrtc"] as? [String: Any],
            let out = try? JSONSerialization.data(withJSONObject: olcrtc)
        else { return nil }
        return String(data: out, encoding: .utf8)
    }

    // MARK: - stopTunnel

    override func stopTunnel(with reason: NEProviderStopReason,
                             completionHandler: @escaping () -> Void) {
        logger.info("stopTunnel: reason=\(reason.rawValue)")
        StopOlcrtc()
        let result = StopXray()
        if result != 0 {
            logger.error("StopXray returned error code \(result)")
        }
        completionHandler()
    }

    // MARK: - handleAppMessage
    // Allows the main app to send commands to the extension at runtime.

    override func handleAppMessage(_ messageData: Data,
                                   completionHandler: ((Data?) -> Void)?) {
        guard
            let obj = try? JSONSerialization.jsonObject(with: messageData) as? [String: Any],
            let cmd = obj["cmd"] as? String
        else {
            completionHandler?(nil)
            return
        }

        switch cmd {
        case "stats":
            // {"cmd":"stats","tag":"proxy"} -> {"uplink":N,"downlink":N}
            let tag = (obj["tag"] as? String) ?? "proxy"
            let json = tag.withCString { QueryStats(UnsafeMutablePointer(mutating: $0)) }
            if let json = json {
                let data = Data(String(cString: json).utf8)
                FreeString(json)
                completionHandler?(data)
            } else {
                completionHandler?(nil)
            }
        case "version":
            if let v = GetVersion() {
                let data = Data(String(cString: v).utf8)
                FreeString(v)
                completionHandler?(data)
            } else {
                completionHandler?(nil)
            }
        default:
            completionHandler?(nil)
        }
    }

    // MARK: - Sleep / Wake

    override func sleep(completionHandler: @escaping () -> Void) {
        completionHandler()
    }

    override func wake() {}

    // MARK: - Private helpers

    /// Valid IPv4/IPv6 DNS servers from the Xray config's `dns.servers`.
    /// Non-IP entries (e.g. "localhost", "https://..." DoH) are dropped since
    /// NEDNSSettings only accepts plain IPs. Returns a neutral default if none.
    private func dnsServers(from configJson: String) -> [String] {
        guard
            let data = configJson.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let dns = obj["dns"] as? [String: Any],
            let servers = dns["servers"] as? [Any]
        else {
            return ["1.1.1.1", "1.0.0.1"]
        }
        let ips = servers.compactMap { $0 as? String }.filter { isIPAddress($0) }
        return ips.isEmpty ? ["1.1.1.1", "1.0.0.1"] : ips
    }

    private func isIPAddress(_ s: String) -> Bool {
        var v4 = in_addr()
        if inet_pton(AF_INET, s, &v4) == 1 { return true }
        var v6 = in6_addr()
        if inet_pton(AF_INET6, s, &v6) == 1 { return true }
        return false
    }

    /// Returns the raw file descriptor of the packet flow TUN socket.
    /// This is the standard approach used by Wireguard-Go, sing-box, etc.
    ///
    /// The old code returned the FIRST fd whose name matched "utun", which is
    /// fragile: an unrelated utun (e.g. a system VPN) can own a lower fd and be
    /// picked by mistake. Our packet tunnel is the most recently created utun,
    /// so it is the HIGHEST-numbered matching fd — scan all and keep the max.
    private func tunnelFileDescriptor() -> Int32? {
        var last: Int32? = nil
        var buf = [CChar](repeating: 0, count: Int(IFNAMSIZ))
        for fd: Int32 in 0..<1024 {
            var len = socklen_t(buf.count)
            if getsockopt(fd, 2 /* SYSPROTO_CONTROL */, 2 /* UTUN_OPT_IFNAME */, &buf, &len) == 0 {
                let name = String(cString: buf)
                if name.hasPrefix("utun") {
                    last = fd
                }
            }
        }
        if let fd = last { return fd }

        // Fallback: read via private KVC key on NEPacketTunnelFlow
        if let val = self.value(forKeyPath: "packetFlow.socket.fileDescriptor") as? Int32 {
            return val
        }
        return nil
    }
}
