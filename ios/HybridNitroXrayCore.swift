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

/// UserDefaults key for the VPN config JSON
private let kConfigKey = "xray_config_json"

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
    // Real counters live in the NE process (QueryStats). Plumbed via
    // sendProviderMessage in the stats pass; zeros until then.

    func getStats(outboundTag: String) throws -> Promise<TrafficStats> {
        return Promise.resolved(withResult: TrafficStats(uplink: 0, downlink: 0))
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
        // 1. Persist config in shared container so Extension can read it
        if let defaults = UserDefaults(suiteName: kAppGroup) {
            print("[HybridNitroXrayCore] Writing config to App Group: \(kAppGroup)")
            defaults.set(configJson, forKey: kConfigKey)
            // defaults.synchronize() is deprecated and can cause CFPrefs error
        } else {
            let errorMsg = "App Group '\(kAppGroup)' not found. Check entitlements."
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
    // The real iOS mechanism is NEOnDemandRule + includeAllNetworks on the
    // tunnel profile; stubbed until the iOS hardening pass.

    func setKillSwitch(enabled: Bool) throws -> Promise<Void> {
        let promise = Promise<Void>()
        promise.reject(withError: NSError(
            domain: "XrayCore", code: -100,
            userInfo: [NSLocalizedDescriptionKey:
                "setKillSwitch is not implemented on iOS yet (planned: NEOnDemandRule + includeAllNetworks)"]))
        return promise
    }

    func isKillSwitchEnabled() throws -> Bool {
        return false
    }

    // MARK: - olcrtc (iOS: second pass — see docs/IMPLEMENTATION_PLAN.md)
    // The merged Android core builds; iOS needs an olcrtc_ios.go equivalent and
    // a memory study (48 MB lib vs NE ~15 MB limit) before wiring. Stubbed so
    // the shared spec compiles.

    func startOlcrtc(configJson: String) throws -> Promise<Void> {
        let promise = Promise<Void>()
        promise.reject(withError: NSError(
            domain: "XrayCore", code: -101,
            userInfo: [NSLocalizedDescriptionKey:
                "startOlcrtc is not implemented on iOS yet (merged core is Android-first)"]))
        return promise
    }

    func stopOlcrtc() throws -> Promise<Void> {
        return Promise.resolved(withResult: ())
    }

    func getOlcrtcSocksPort() throws -> Double {
        return 0
    }

    func isOlcrtcRunning() throws -> Bool {
        return false
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

            mgr.protocolConfiguration = proto
            mgr.localizedDescription = "Xray VPN"
            mgr.isEnabled = true

            completion(.success(mgr))
        }
    }
}
