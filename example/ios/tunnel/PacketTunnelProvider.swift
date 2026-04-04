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

// MARK: - Logger
private let logger = Logger(subsystem: "com.xraycore.example.tunnel", category: "PacketTunnel")

class PacketTunnelProvider: NEPacketTunnelProvider {

    // MARK: - startTunnel

    override func startTunnel(options: [String: NSObject]?,
                              completionHandler: @escaping (Error?) -> Void) {
        logger.info("startTunnel called")

        var configJson: String? = options?["config"] as? String

        if let defaults = UserDefaults(suiteName: kAppGroup) {
            logger.info("UserDefaults for App Group '\(kAppGroup)' initialized.")
            if configJson == nil {
                configJson = defaults.string(forKey: kConfigKey)
            }
        } else {
            logger.warning("Could not initialize UserDefaults for App Group: \(kAppGroup). Falling back to options dictionary.")
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

        // DNS — use Xray's built-in resolver; localhost proxy addresses
        settings.dnsSettings = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])

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

            // 5. Start Xray Core ——————————————————————————————————————————
            //    StartXray is exported from the Go library (libxray.a / Xray.xcframework).
            //    It receives the JSON config and the raw TUN fd.
            let result = finalConfig.withCString { ptr in
                StartXray(UnsafeMutablePointer(mutating: ptr), Int32(tunFd))
            }

            if result != 0 {
                let err = NSError(domain: "XrayTunnel", code: Int(result),
                                  userInfo: [NSLocalizedDescriptionKey: "StartXray returned error code \(result)"])
                logger.error("StartXray failed: \(result)")
                completionHandler(err)
            } else {
                logger.info("Xray started successfully")
                completionHandler(nil)
            }
        }
    }

    // MARK: - stopTunnel

    override func stopTunnel(with reason: NEProviderStopReason,
                             completionHandler: @escaping () -> Void) {
        logger.info("stopTunnel: reason=\(reason.rawValue)")
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
        if let msg = String(data: messageData, encoding: .utf8) {
            logger.info("handleAppMessage: \(msg)")
        }
        completionHandler?(messageData)
    }

    // MARK: - Sleep / Wake

    override func sleep(completionHandler: @escaping () -> Void) {
        completionHandler()
    }

    override func wake() {}

    // MARK: - Private helpers

    /// Returns the raw file descriptor of the packet flow TUN socket.
    /// This is the standard approach used by Wireguard-Go, sing-box, etc.
    private func tunnelFileDescriptor() -> Int32? {
        var buf = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        var len = socklen_t(MAXPATHLEN)
        // utun kernel socket
        for fd: Int32 in 0..<256 {
            if getsockopt(fd, 2 /* SYSPROTO_CONTROL */, 2 /* UTUN_OPT_IFNAME */, &buf, &len) == 0 {
                return fd
            }
        }

        // Fallback: read via private KVC key on NEPacketTunnelFlow
        let key = "socket.fileDescriptor"
        if let val = self.value(forKeyPath: "packetFlow.\(key)") as? Int32 {
            return val
        }

        return nil
    }
}
