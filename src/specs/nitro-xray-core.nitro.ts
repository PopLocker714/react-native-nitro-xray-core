import type { HybridObject } from 'react-native-nitro-modules'

/**
 * Traffic counters for the active connection, in bytes.
 * Values are cumulative since the engine started.
 */
export interface TrafficStats {
  uplink: number
  downlink: number
}

/**
 * Low-level connection lifecycle state emitted by the native engine.
 * Kept as a plain string (not a native enum) so the value stays stable
 * across the JS/native boundary and is trivial to extend.
 *
 * One of: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error'
 */
export type XrayState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error'

export interface NitroXrayCore extends HybridObject<{ ios: 'swift', android: 'kotlin' }> {
  hasVpnPermission(): Promise<boolean>
  requestVpnPermission(): Promise<void>
  requestNotificationPermission(): Promise<boolean>
  isVpnConnected(): boolean

  /** Xray-core version string (e.g. "1.8.24"). */
  getVersion(): string

  /**
   * Start the engine with a raw Xray JSON config.
   * Resolves only after the native engine has actually started, and
   * rejects with the underlying error if startup fails.
   */
  startXray(configJson: string): Promise<void>

  /** Stop the engine and tear down the tunnel. */
  stopXray(): Promise<void>

  /**
   * Toggle the kill switch. When enabled (Android): if the engine dies or
   * fails to start while the tunnel is up, the TUN interface is kept
   * established so all traffic blackholes instead of leaking onto the open
   * network. An explicit stopXray() always tears everything down.
   * Note: this is app-level. OS-level guarantees (block traffic when the
   * app itself is killed) require the system Always-on VPN + Lockdown
   * setting, which only the user can enable. iOS: not implemented yet.
   */
  setKillSwitch(enabled: boolean): Promise<void>

  /** Current kill-switch flag (persisted across app restarts). */
  isKillSwitchEnabled(): boolean

  /**
   * Query cumulative traffic counters for a given outbound tag.
   * Requires `stats` + `policy` blocks in the running config (the config
   * builder adds them automatically). Returns zeros if stats are unavailable.
   */
  getStats(outboundTag: string): Promise<TrafficStats>

  /**
   * Register the single native state callback. The JS wrapper multiplexes
   * this to any number of subscribers, so callers should use the wrapper's
   * `addStateListener` rather than calling this directly.
   */
  onStateChange(callback: (state: string, message: string) => void): void

  /**
   * Start the olcrtc WebRTC side-channel client (the "Russia bypass" path).
   * It runs SOCKS-only in-process — no TUN of its own; the xray engine owns
   * the TUN and dials its server outbound through olcrtc's local SOCKS5 via
   * `dialerProxy`. `configJson` carries the olcrtc client params (carrier,
   * roomId, clientId, keyHex, socksPort, ...). Resolves once the SOCKS
   * listener is ready; rejects with the underlying error on failure.
   * Android only for now (iOS: not implemented — see IMPLEMENTATION_PLAN.md).
   */
  startOlcrtc(configJson: string): Promise<void>

  /** Stop the olcrtc client and release its SOCKS5 listener. */
  stopOlcrtc(): Promise<void>

  /**
   * The local SOCKS5 port the running olcrtc client listens on, or 0 when it
   * is not running. Feed this into the config builder's `olcrtc.socksPort`.
   */
  getOlcrtcSocksPort(): number

  /** Whether the olcrtc client is currently running. */
  isOlcrtcRunning(): boolean
}
