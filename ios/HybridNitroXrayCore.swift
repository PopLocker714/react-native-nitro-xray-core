//
//  HybridNitroXrayCore.swift
//  Pods
//
//  Created by  on 4/1/2026.
//

import Foundation

class HybridNitroXrayCore: HybridNitroXrayCoreSpec {
    func hasVpnPermission() throws -> Promise<Bool> {
        return Promise.resolved(withResult: true)
    }

    func requestVpnPermission() throws -> Promise<Void> {
        return Promise.resolved(withResult: ())
    }

    func requestNotificationPermission() throws -> Promise<Bool> {
        return Promise.resolved(withResult: true)
    }

    func startXray(configJson: String) throws -> Promise<Void> {
        return Promise.resolved(withResult: ())
    }

    func stopXray() throws -> Promise<Void> {
        return Promise.resolved(withResult: ())
    }
}
