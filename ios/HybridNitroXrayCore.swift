// ios/HybridNitroXrayCore.swift
// Full implementation using NETunnelProviderManager

import Foundation
import NetworkExtension
import NitroModules

/// Bundle ID of the Packet Tunnel Extension target.
/// Must match the bundle identifier set in Xcode for the "tunnel" target.
private var kTunnelBundleID: String {
    return Bundle.main.bundleIdentifier! + ".tunnel"
}

/// App Group shared between the main app and the extension.
/// Used to pass the Xray JSON config via shared UserDefaults.
private var kAppGroup: String {
    return "group." + Bundle.main.bundleIdentifier!
}

/// UserDefaults key for the VPN config JSON (legacy App Group fallback)
private let kConfigKey = "xray_config_json"

/// Encrypted config storage shared between the app and the Network Extension
/// via a Keychain access group. Preferred over the App Group plist because
/// Keychain items are encrypted at rest and device-bound (not backed up / not
/// synced). Falls back gracefully: if the access group isn't configured, save
/// returns false and the caller uses the App Group.
enum XrayKeychain {
    // Suffix of the shared keychain-access-group (see both .entitlements files).
    // The team prefix is resolved at runtime so the library isn't tied to a team.
    private static let accessGroupSuffix = "com.xraycore.example.shared"
    private static let account = "xray_config_json"
    private static let service = "com.xraycore.vpn"

    static func resolveAccessGroup() -> String? {
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

    @discardableResult
    static func save(_ config: String) -> Bool {
        guard let group = resolveAccessGroup(),
              let data = config.data(using: .utf8) else { return false }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: group,
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
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

    static func clear() {
        guard let group = resolveAccessGroup() else { return }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: group,
        ]
        SecItemDelete(base as CFDictionary)
    }
}

class HybridNitroXrayCore: HybridNitroXrayCoreSpec {

    // MARK: - Internal state

    private var manager: NETunnelProviderManager?
    private var stateCallback: ((String, String) -> Void)?
    private var statusObserver: NSObjectProtocol?

    deinit {
        if let obs = statusObserver {
            NotificationCenter.default.removeObserver(obs)
        }
    }

    // MARK: - getVersion
    // The Xray engine runs in the Network Extension process, not here, so the
    // app can't call the Go GetVersion() directly. Reported via the NE in a
    // later pass; empty for now.

    func getVersion() throws -> String {
        return ""
    }

    // MARK: - getStats
    // The engine runs in the NE process, so query it over the provider message
    // channel: the app sends {"cmd":"stats","tag":...}; the extension replies
    // with {"uplink":N,"downlink":N}. Resolves to zeros when not connected.

    func getStats(outboundTag: String) throws -> Promise<TrafficStats> {
        let promise = Promise<TrafficStats>()
        guard let session = manager?.connection as? NETunnelProviderSession,
              session.status == .connected,
              let data = try? JSONSerialization.data(withJSONObject: ["cmd": "stats", "tag": outboundTag])
        else {
            promise.resolve(withResult: TrafficStats(uplink: 0, downlink: 0))
            return promise
        }
        do {
            try session.sendProviderMessage(data) { resp in
                var up = 0.0
                var down = 0.0
                if let resp = resp,
                   let obj = try? JSONSerialization.jsonObject(with: resp) as? [String: Any] {
                    up = (obj["uplink"] as? NSNumber)?.doubleValue ?? 0
                    down = (obj["downlink"] as? NSNumber)?.doubleValue ?? 0
                }
                promise.resolve(withResult: TrafficStats(uplink: up, downlink: down))
            }
        } catch {
            promise.resolve(withResult: TrafficStats(uplink: 0, downlink: 0))
        }
        return promise
    }

    // MARK: - onStateChange
    // Bridges NEVPNStatusDidChange to the JS state callback. Loads the current
    // manager so status is correct even after an app restart, emits the current
    // status once, then streams changes.

    func onStateChange(callback: @escaping (String, String) -> Void) throws {
        self.stateCallback = callback
        NETunnelProviderManager.loadAllFromPreferences { [weak self] managers, _ in
            guard let self = self else { return }
            if let mgr = managers?.first(where: {
                ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == kTunnelBundleID
            }) {
                self.manager = mgr
            }
            if let status = self.manager?.connection.status {
                self.emitState(status)
            }
            if self.statusObserver == nil {
                self.statusObserver = NotificationCenter.default.addObserver(
                    forName: .NEVPNStatusDidChange, object: nil, queue: .main
                ) { [weak self] _ in
                    guard let self = self, let status = self.manager?.connection.status else { return }
                    self.emitState(status)
                }
            }
        }
    }

    private func emitState(_ status: NEVPNStatus) {
        let s: String
        switch status {
        case .connecting, .reasserting: s = "connecting"
        case .connected: s = "connected"
        case .disconnecting: s = "disconnecting"
        case .disconnected, .invalid: s = "disconnected"
        @unknown default: s = "disconnected"
        }
        self.stateCallback?(s, "")
    }

    // MARK: - hasVpnPermission

    func hasVpnPermission() throws -> Promise<Bool> {
        let promise = Promise<Bool>()
        NETunnelProviderManager.loadAllFromPreferences { managers, error in
            if let error = error {
                // loadAllFromPreferences failing usually means no permission yet
                print("[HybridNitroXrayCore] loadAllFromPreferences error: \(error)")
                promise.resolve(withResult: false)
                return
            }
            // If a matching manager already exists the user already granted VPN permission
            let exists = managers?.contains {
                ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == kTunnelBundleID
            } ?? false
            promise.resolve(withResult: exists)
        }
        return promise
    }

    // MARK: - requestVpnPermission

    func requestVpnPermission() throws -> Promise<Void> {
        let promise = Promise<Void>()
        self.loadOrCreateManager { result in
            switch result {
            case .success(let mgr):
                // Saving the profile triggers the system VPN permission dialog
                mgr.saveToPreferences { error in
                    if let error = error {
                        promise.reject(withError: error)
                    } else {
                        promise.resolve()
                    }
                }
            case .failure(let error):
                promise.reject(withError: error)
            }
        }
        return promise
    }

    // MARK: - isVpnConnected

    func isVpnConnected() throws -> Bool {
        guard let mgr = manager else { return false }
        return mgr.connection.status == .connected
    }

    // MARK: - requestNotificationPermission
    // iOS does not require notification permission for VPN — returning true immediately.

    func requestNotificationPermission() throws -> Promise<Bool> {
        return Promise.resolved(withResult: true)
    }

    // MARK: - startXray

    func startXray(configJson: String) throws -> Promise<Void> {
        let promise = Promise<Void>()

        // 0. If an olcrtc client config is armed (startOlcrtc was called), embed
        //    it as a top-level "olcrtc" block so the NE starts olcrtc before xray.
        //    xray's config already dials through it via dialerProxy.
        let effectiveConfig = embedOlcrtc(into: configJson)

        // 1. Persist config so the Extension can read it on an on-demand cold
        //    start (when startVPNTunnel options aren't available). Prefer the
        //    encrypted Keychain; fall back to the App Group only if the shared
        //    keychain group isn't configured.
        let configJson = effectiveConfig
        if XrayKeychain.save(configJson) {
            print("[HybridNitroXrayCore] Config saved to Keychain (shared group).")
        } else if let defaults = UserDefaults(suiteName: kAppGroup) {
            print("[HybridNitroXrayCore] Keychain unavailable; wrote config to App Group.")
            defaults.set(configJson, forKey: kConfigKey)
        } else {
            let errorMsg = "No secure store: Keychain group and App Group '\(kAppGroup)' both unavailable. Check entitlements."
            print("[HybridNitroXrayCore] ERROR: \(errorMsg)")
            promise.reject(withError: NSError(domain: "XrayCore", code: -1,
                           userInfo: [NSLocalizedDescriptionKey: errorMsg]))
            return promise
        }

        // 2. Load / create the VPN manager profile
        self.loadOrCreateManager { result in
            switch result {
            case .failure(let error):
                promise.reject(withError: error)

            case .success(let mgr):
                self.manager = mgr

                // 3. Save profile (needed on first run; no-op on subsequent calls)
                mgr.saveToPreferences { saveError in
                    if let saveError = saveError {
                        promise.reject(withError: saveError)
                        return
                    }

                    // 4. Reload from preferences (required by Apple after save)
                    mgr.loadFromPreferences { loadError in
                        if let loadError = loadError {
                            promise.reject(withError: loadError)
                            return
                        }

                        // 5. Start the tunnel
                        do {
                            try mgr.connection.startVPNTunnel(options: [
                                "config": configJson as NSObject
                            ])
                            print("[HybridNitroXrayCore] startVPNTunnel called successfully.")
                            promise.resolve()
                        } catch {
                            print("[HybridNitroXrayCore] startVPNTunnel ERROR: \(error)")
                            promise.reject(withError: error)
                        }
                    }
                }
            }
        }
        return promise
    }

    // MARK: - stopXray

    func stopXray() throws -> Promise<Void> {
        manager?.connection.stopVPNTunnel()
        manager = nil
        return Promise.resolved(withResult: ())
    }

    // MARK: - Kill switch (iOS: second pass — see docs/IMPLEMENTATION_PLAN.md)
    // iOS kill switch: on-demand keeps the VPN "always on" (reconnects), and
    // includeAllNetworks blocks traffic that would otherwise bypass the tunnel
    // while it's down — the fail-closed behavior. Persisted in UserDefaults and
    // written onto the tunnel profile. Note: enabling this shows the system VPN
    // save prompt on first apply, and the OS enforces it (unlike Android's
    // app-level hold). Takes effect on the next connect.

    private static let kKillSwitchKey = "xray_kill_switch"

    func setKillSwitch(enabled: Bool) throws -> Promise<Void> {
        UserDefaults.standard.set(enabled, forKey: Self.kKillSwitchKey)
        let promise = Promise<Void>()
        self.loadOrCreateManager { result in
            switch result {
            case .failure(let error):
                promise.reject(withError: error)
            case .success(let mgr):
                if enabled {
                    let rule = NEOnDemandRuleConnect()
                    rule.interfaceTypeMatch = .any
                    mgr.onDemandRules = [rule]
                    mgr.isOnDemandEnabled = true
                } else {
                    mgr.onDemandRules = []
                    mgr.isOnDemandEnabled = false
                }
                if let proto = mgr.protocolConfiguration as? NETunnelProviderProtocol {
                    proto.includeAllNetworks = enabled
                    proto.excludeLocalNetworks = true
                }
                mgr.isEnabled = true
                self.manager = mgr
                mgr.saveToPreferences { error in
                    if let error = error {
                        promise.reject(withError: error)
                    } else {
                        promise.resolve()
                    }
                }
            }
        }
        return promise
    }

    func isKillSwitchEnabled() throws -> Bool {
        return UserDefaults.standard.bool(forKey: Self.kKillSwitchKey)
    }

    // MARK: - olcrtc (iOS)
    // olcrtc runs inside the Network Extension (that's where the merged core
    // loads), not in this app process — so it can't be started before the
    // tunnel exists. Instead we record the client config here; startXray embeds
    // it as a top-level "olcrtc" block in the config, and the NE starts olcrtc
    // (SOCKS-only) before xray. Memory-tight: merged runtime peaks ~57MB in the
    // NE (~50MB budget). The JS flow (startOlcrtc → connect) is unchanged.

    private var pendingOlcrtcConfig: String?
    private var olcrtcPort: Int = 0

    func startOlcrtc(configJson: String) throws -> Promise<Void> {
        pendingOlcrtcConfig = configJson
        // Resolve the SOCKS port (must match the dialerProxy the config builder
        // wires). Default 10808, same as the native side.
        var port = 10808
        if let data = configJson.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let p = obj["socksPort"] as? NSNumber, p.intValue > 0 {
            port = p.intValue
        }
        olcrtcPort = port
        return Promise.resolved(withResult: ())
    }

    func stopOlcrtc() throws -> Promise<Void> {
        pendingOlcrtcConfig = nil
        olcrtcPort = 0
        return Promise.resolved(withResult: ())
    }

    func getOlcrtcSocksPort() throws -> Double {
        return Double(olcrtcPort)
    }

    func isOlcrtcRunning() throws -> Bool {
        // On iOS olcrtc's lifetime is the tunnel's: "armed" once a config is set
        // and the tunnel is up.
        return pendingOlcrtcConfig != nil && (manager?.connection.status == .connected)
    }

    /// If an olcrtc client config is armed, inject it as the config's top-level
    /// "olcrtc" block so the NE starts olcrtc before xray. Returns the config
    /// unchanged when nothing is armed or JSON handling fails.
    private func embedOlcrtc(into configJson: String) -> String {
        guard let olcrtcJson = pendingOlcrtcConfig,
              let cfgData = configJson.data(using: .utf8),
              var cfg = (try? JSONSerialization.jsonObject(with: cfgData)) as? [String: Any],
              let olData = olcrtcJson.data(using: .utf8),
              let ol = (try? JSONSerialization.jsonObject(with: olData)) as? [String: Any]
        else { return configJson }
        cfg["olcrtc"] = ol
        guard let out = try? JSONSerialization.data(withJSONObject: cfg),
              let s = String(data: out, encoding: .utf8) else { return configJson }
        return s
    }

    // iOS: the system owns the VPN status UI; notification text isn't applicable.
    func setNotificationConfig(config: NotificationConfig) throws {
        // no-op
    }

    // MARK: - Private helpers

    private func loadOrCreateManager(completion: @escaping (Result<NETunnelProviderManager, Error>) -> Void) {
        NETunnelProviderManager.loadAllFromPreferences { managers, error in
            if let error = error {
                completion(.failure(error))
                return
            }

            // Reuse an existing manager if one matches our extension
            let existing = managers?.first {
                ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == kTunnelBundleID
            }

            let mgr = existing ?? NETunnelProviderManager()

            let proto = NETunnelProviderProtocol()
            proto.providerBundleIdentifier = kTunnelBundleID
            proto.serverAddress = "Xray VPN"   // Shown in iOS Settings → VPN
            // Pass App Group so Extension can read config
            proto.providerConfiguration = ["appGroup": kAppGroup]

            // Re-apply the persisted kill-switch setting on every profile write,
            // otherwise rebuilding proto here would drop includeAllNetworks.
            let killSwitch = UserDefaults.standard.bool(forKey: Self.kKillSwitchKey)
            proto.includeAllNetworks = killSwitch
            proto.excludeLocalNetworks = true

            mgr.protocolConfiguration = proto
            mgr.localizedDescription = "Xray VPN"
            mgr.isEnabled = true
            if killSwitch {
                let rule = NEOnDemandRuleConnect()
                rule.interfaceTypeMatch = .any
                mgr.onDemandRules = [rule]
                mgr.isOnDemandEnabled = true
            } else {
                mgr.onDemandRules = []
                mgr.isOnDemandEnabled = false
            }

            completion(.success(mgr))
        }
    }
}
