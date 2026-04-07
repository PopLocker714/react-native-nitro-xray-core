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
