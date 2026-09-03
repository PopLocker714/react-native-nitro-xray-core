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
 * One of: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' |
 * 'error' | 'reconnecting' | 'blocked'
 */
export type XrayState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error'
  /** iOS: the tunnel is re-establishing after a network change (Wi-Fi↔cellular),
   *  distinct from a fresh 'connecting'. Android has no equivalent event. */
  | 'reconnecting'
  /**
   * Android: the engine failed while the kill switch was on, so the tunnel is
   * deliberately held with nothing behind it and every packet is dropped.
   *
   * Distinct from 'error' on purpose. 'error' means "we failed and your traffic
   * is on the open network"; 'blocked' means "we failed and your traffic is
   * being withheld" — the user still has a VPN key icon, no working network,
   * and the only way out is an explicit disconnect. A UI that renders this as a
   * plain error will offer Connect where it must offer Disconnect.
   */
  | 'blocked'

/**
 * Text for the persistent foreground VPN notification (Android). All fields are
 * optional so callers translate only what they need; unset fields keep the
 * built-in English defaults. Apply via {@link NitroXrayCore.setNotificationConfig}
 * before connecting (and again to switch language at runtime).
 */
export interface NotificationConfig {
  /** Notification title. Default "VPN Active". */
  title?: string
  /** Body text shown while connected. Default "Protecting your connection". */
  text?: string
  /** Label of the Disconnect action button. Default "Disconnect". */
  disconnectLabel?: string
  /** Text shown when the kill switch is holding traffic. Default "Kill switch: traffic blocked". */
  blockedText?: string
  /** Android notification channel name. Default "VPN". */
  channelName?: string
}

export interface NitroXrayCore extends HybridObject<{ ios: 'swift', android: 'kotlin' }> {
  hasVpnPermission(): Promise<boolean>
  requestVpnPermission(): Promise<void>
  requestNotificationPermission(): Promise<boolean>
  /**
   * Whether this app is currently capturing traffic — i.e. the tunnel
   * interface is established.
   *
   * It tracks the INTERFACE, not the engine, so it stays true across a server
   * switch (the tunnel is never dropped) and during a kill-switch hold (the
   * tunnel is held on purpose with a dead engine). Use the state stream to
   * tell those apart: 'connected' vs 'blocked'.
   */
  isVpnConnected(): boolean

  /**
   * Whether the proxy engine is actually running behind the tunnel.
   *
   * Differs from {@link isVpnConnected} in exactly one situation, and that
   * situation is the whole reason it exists: on Android a kill-switch hold
   * keeps the tunnel established with a dead engine, so traffic is captured and
   * dropped. `isVpnConnected() && !isEngineRunning()` is therefore the
   * native-side definition of the `blocked` state, and the only way to recover
   * it after a JS reload — without this, a restarted UI reads "tunnel up" and
   * cheerfully reports a healthy connection over a blackhole.
   *
   * iOS: identical to {@link isVpnConnected} — the engine lives inside the
   * Network Extension and cannot outlive its tunnel.
   */
  isEngineRunning(): boolean

  /**
   * Opt in to storing the last successful connection so it can be brought back
   * up from OUTSIDE the JS runtime — a home-screen widget, a Quick Settings
   * tile, a shortcut. Those run in a cold process where React Native is not
   * loaded, so they cannot build a config and can only replay one.
   *
   * Off by default, and opt-in on purpose: an Xray config carries the server
   * credential, so enabling this puts a secret at rest in the app's private
   * storage. An app with no such entry point should never pay that cost.
   * Disabling wipes what was stored.
   *
   * Android only. iOS: no-op — there the tunnel is brought back by the system's
   * on-demand rules rather than by a process-external toggle.
   */
  setQuickConnectEnabled(enabled: boolean): void

  /**
   * Whether a one-tap reconnect is possible right now, i.e. the feature is
   * enabled AND a connection has succeeded at least once since. Render a widget
   * or tile as "open the app first" while this is false.
   */
  isQuickConnectReady(): boolean

  /**
   * Xray-core version string as reported by the engine, e.g. "26.3.27"
   * (XTLS switched to a date-derived scheme; the Go module tag for the same
   * release is "v1.260327.0"). Empty string when the engine is unreachable —
   * on iOS the core lives in the Network Extension, so this is only populated
   * after the first connect.
   */
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

  /**
   * Configure the persistent foreground VPN notification text/labels (Android).
   * Persists across service/process restarts; call again to change language at
   * runtime. The notification always carries a Disconnect action button.
   * iOS: no-op (the system manages the VPN status UI).
   */
  setNotificationConfig(config: NotificationConfig): void

  /**
   * Set the VPN display name shown in iOS Settings → VPN (the profile's
   * `localizedDescription` / `serverAddress`) — for branding. Persisted and
   * applied to the tunnel profile on the next connect. Default "Xray VPN".
   * Android: no-op (the system uses the app label there).
   */
  setVpnName(name: string): void

  /**
   * Persist a JSON blob describing the current connection (server, protocol,
   * olcrtc params, mode). Set by the JS client on connect, cleared on disconnect.
   * Survives an app restart so the UI can show what's connected even when the
   * tunnel was brought up by on-demand while the app was closed. Empty = none.
   */
  setConnectionInfo(json: string): void

  /** The JSON blob last stored via {@link setConnectionInfo}, or "" if none. */
  getConnectionInfo(): string
}
