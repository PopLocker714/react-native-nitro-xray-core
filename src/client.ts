import { NitroXrayCore, addStateListener } from './native'
import type { StateListener } from './native'
import { buildXrayConfig, buildOlcrtcTunnelConfig } from './config/build'
import type { BuildConfigOptions, OlcrtcTunnelOptions } from './config/build'
import {
  parseShareLink,
  parseSubscription,
  parseSubscriptionUserInfo,
} from './subscription/parse'
import type { ParsedServer, SubscriptionInfo } from './subscription/types'
import type { TrafficStats, NotificationConfig } from './specs/nitro-xray-core.nitro'
import { urlTest } from './urltest/urltest'
import type { UrlTestOptions, UrlTestResult } from './urltest/urltest'
import type { OlcrtcClientConfig } from './olcrtc/types'
import { createSerialLock } from './lock'

export interface ConnectOptions extends BuildConfigOptions {}

// Serialize all engine/profile-mutating calls. Without this, overlapping calls
// (a double-tapped Connect, or connect-then-disconnect) interleave: on iOS a
// disconnect during an in-flight connect can be silently lost and the tunnel
// comes up anyway; on Android the start-completion slot races. Read-only calls
// (stats, isConnected, version, ...) are intentionally NOT locked.
const withLock = createSerialLock()

/** Default timeout for subscription HTTP fetches (ms). */
const SUBSCRIPTION_TIMEOUT_MS = 15000

/** Result of {@link XrayClient.fromSubscriptionWithInfo}. */
export interface SubscriptionResult {
  servers: ParsedServer[]
  /** Quota/expiry from the `subscription-userinfo` header, if the server sent it. */
  info: SubscriptionInfo | null
}

// Session-continuous traffic accounting per outbound tag. Raw engine counters
// reset whenever the engine restarts (e.g. server switch); these sessions fold
// each engine generation into a baseline so totals only grow mid-session.
import { TrafficSession } from './stats/session'

const trafficSessions = new Map<string, TrafficSession>()

function trafficSession(tag: string): TrafficSession {
  let session = trafficSessions.get(tag)
  if (!session) {
    session = new TrafficSession()
    trafficSessions.set(tag, session)
  }
  return session
}

function resetTrafficSessions(): void {
  for (const session of trafficSessions.values()) session.reset()
}

// Engine restarts (server switch) are detected primarily via state events:
// 'connecting' freezes the sessions, the next terminal state banks the
// previous engine generation. This catches restarts even when the new
// counter overtakes the old one before the next poll (backgrounded app) —
// the raw<last heuristic in TrafficSession stays as a fallback for
// platforms where state events don't fire.
let sessionStateHookRegistered = false

function ensureSessionStateHook(): void {
  if (sessionStateHookRegistered) return
  sessionStateHookRegistered = true
  addStateListener((state) => {
    if (state === 'connecting') {
      for (const session of trafficSessions.values()) session.suspend()
    } else if (
      state === 'connected' ||
      state === 'disconnected' ||
      state === 'error'
    ) {
      for (const session of trafficSessions.values()) session.commitRestart()
    }
  })
}

async function fetchSubscription(
  url: string,
  init?: RequestInit
): Promise<Response> {
  // Time-box the fetch: on a throttled/censored network (exactly where this
  // library is used) a subscription host can hold the socket open forever, and
  // the app's spinner would spin with no way to cancel.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SUBSCRIPTION_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      ...init,
      headers: {
        'User-Agent': 'react-native-nitro-xray-core',
        Accept: '*/*',
        ...init?.headers,
      },
    })
    if (!response.ok) {
      throw new Error(`Subscription fetch failed: HTTP ${response.status}`)
    }
    return response
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(
        `Subscription fetch timed out after ${SUBSCRIPTION_TIMEOUT_MS}ms`
      )
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * High-level VPN client: the recommended entry point for apps.
 *
 * It layers subscription parsing and typed config building on top of the raw
 * Nitro engine, while leaving `startRaw` as an escape hatch for callers that
 * already have hand-written Xray JSON.
 *
 * The proxy outbound is always tagged `proxy` (overridable), and `stats()`
 * queries that same tag — so traffic accounting works out of the box.
 */
export const XrayClient = {
  /** Parse a subscription URL's contents (base64 blob or raw links). */
  parseSubscription(payload: string): ParsedServer[] {
    return parseSubscription(payload)
  },

  /** Parse a single share link (vless/vmess/ss/trojan). */
  parseLink(uri: string): ParsedServer | null {
    return parseShareLink(uri)
  },

  /**
   * Fetch a subscription over HTTP and parse it into a server list.
   * A default User-Agent is sent because many subscription servers gate or
   * shape their response by client UA; override via `init.headers`.
   */
  async fromSubscription(
    url: string,
    init?: RequestInit
  ): Promise<ParsedServer[]> {
    const response = await fetchSubscription(url, init)
    return parseSubscription(await response.text())
  },

  /**
   * Like {@link fromSubscription}, but also returns account quota/expiry
   * parsed from the `subscription-userinfo` response header (bytes used,
   * total quota, expiry timestamp). `info` is null when the server does not
   * send the header.
   */
  async fromSubscriptionWithInfo(
    url: string,
    init?: RequestInit
  ): Promise<SubscriptionResult> {
    const response = await fetchSubscription(url, init)
    return {
      servers: parseSubscription(await response.text()),
      info: parseSubscriptionUserInfo(
        response.headers.get('subscription-userinfo')
      ),
    }
  },

  /** Build a full Xray config from a parsed server without connecting. */
  buildConfig(
    server: ParsedServer,
    options?: ConnectOptions
  ): Record<string, unknown> {
    return buildXrayConfig(server, options)
  },

  /**
   * Connect to a parsed server. Builds the config, then starts the engine.
   * Resolves once the native engine has actually started.
   */
  async connect(server: ParsedServer, options?: ConnectOptions): Promise<void> {
    return withLock(async () => {
      // A fresh connection starts a fresh traffic session; switching servers
      // while connected keeps accumulating across the engine restart.
      ensureSessionStateHook()
      if (!NitroXrayCore.isVpnConnected()) resetTrafficSessions()
      const config = buildXrayConfig(server, options)
      await NitroXrayCore.startXray(JSON.stringify(config))
    })
  },

  /** Start the engine from raw Xray JSON (escape hatch / advanced use). */
  async startRaw(configJson: string): Promise<void> {
    return withLock(async () => {
      ensureSessionStateHook()
      if (!NitroXrayCore.isVpnConnected()) resetTrafficSessions()
      await NitroXrayCore.startXray(configJson)
    })
  },

  /**
   * Stop the engine and tear down the tunnel. Also stops olcrtc if it's
   * running, so the WebRTC side-channel doesn't keep talking to the carrier
   * after the user disconnects.
   */
  async disconnect(): Promise<void> {
    return withLock(async () => {
      // Stop olcrtc first (best-effort) so no side-channel outlives the tunnel.
      try {
        if (NitroXrayCore.isOlcrtcRunning()) await NitroXrayCore.stopOlcrtc()
      } catch {
        // ignore — proceed with the engine teardown regardless
      }
      await NitroXrayCore.stopXray()
      resetTrafficSessions()
    })
  },

  /** Synchronous best-effort connection flag. */
  isConnected(): boolean {
    return NitroXrayCore.isVpnConnected()
  },

  /**
   * Session-cumulative traffic counters for the proxy outbound (default tag
   * 'proxy'). Unlike the raw engine counters (which reset every time the
   * engine restarts, e.g. on server switch), these keep growing for the whole
   * VPN session: switching servers does not zero them. The session resets on
   * `disconnect()` or when `connect()` starts from a disconnected state.
   *
   * Accuracy note: bytes transferred between the last poll before a switch
   * and the engine restart are not banked — totals are display-grade, not
   * billing-grade.
   */
  async stats(outboundTag = 'proxy'): Promise<TrafficStats> {
    ensureSessionStateHook()
    const raw = await NitroXrayCore.getStats(outboundTag)
    return trafficSession(outboundTag).update(raw)
  },

  /**
   * Raw engine counters for one outbound tag — cumulative since the current
   * engine instance started, resetting on every restart (server switch).
   * Prefer `stats()` for UI display.
   */
  async statsRaw(outboundTag = 'proxy'): Promise<TrafficStats> {
    return NitroXrayCore.getStats(outboundTag)
  },

  /** Xray-core version string. */
  version(): string {
    return NitroXrayCore.getVersion()
  },

  /**
   * Toggle the kill switch (Android): on engine failure the TUN stays up and
   * blackholes traffic instead of leaking. Explicit disconnect always wins.
   * iOS: rejects until the iOS hardening pass.
   */
  async setKillSwitch(enabled: boolean): Promise<void> {
    // Serialized: on iOS this rewrites the tunnel profile (saveToPreferences),
    // which must not race a connect/disconnect.
    return withLock(() => NitroXrayCore.setKillSwitch(enabled))
  },

  /** Current kill-switch flag (persisted across app restarts). */
  isKillSwitchEnabled(): boolean {
    return NitroXrayCore.isKillSwitchEnabled()
  },

  /**
   * Probe reachability latency for each server and return the list sorted
   * fastest-first (unreachable last). MVP: HTTP probe to `address:port` —
   * ranking-grade signal, not proxy throughput. See `urlTest` docs.
   */
  async urlTest(
    servers: ParsedServer[],
    options?: UrlTestOptions
  ): Promise<UrlTestResult[]> {
    return urlTest(servers, options)
  },

  /** Subscribe to connection-state changes; returns an unsubscribe function. */
  onState(listener: StateListener): () => void {
    return addStateListener(listener)
  },

  /**
   * Start the olcrtc WebRTC side-channel client (the "Russia bypass" path).
   * Resolves once its local SOCKS5 listener is ready. Start this BEFORE
   * `connect()`, then pass `getOlcrtcSocksPort()` into
   * `connect(server, { olcrtc: { socksPort } })` so xray dials the server
   * through olcrtc. Android only for now (iOS rejects until the second pass).
   */
  async startOlcrtc(config: OlcrtcClientConfig): Promise<void> {
    return withLock(() => NitroXrayCore.startOlcrtc(JSON.stringify(config)))
  },

  /** Stop the olcrtc client and release its SOCKS5 listener. */
  async stopOlcrtc(): Promise<void> {
    return withLock(() => NitroXrayCore.stopOlcrtc())
  },

  /**
   * Connect using olcrtc as the tunnel WITHOUT a VLESS/proxy server: TUN →
   * olcrtc's local SOCKS5 → your olcrtc server → internet. Requires olcrtc to
   * be running already (call {@link startOlcrtc} first). xray is used only as
   * the TUN↔SOCKS plumbing; no subscription server is involved.
   */
  async connectOlcrtcOnly(
    options?: Omit<OlcrtcTunnelOptions, 'socksPort' | 'socksHost'>
  ): Promise<void> {
    return withLock(async () => {
      const socksPort = NitroXrayCore.getOlcrtcSocksPort()
      if (socksPort <= 0) {
        throw new Error('olcrtc is not running — call startOlcrtc() first')
      }
      ensureSessionStateHook()
      if (!NitroXrayCore.isVpnConnected()) resetTrafficSessions()
      const config = buildOlcrtcTunnelConfig({ socksPort, ...options })
      await NitroXrayCore.startXray(JSON.stringify(config))
    })
  },

  /**
   * Local SOCKS5 port the running olcrtc client listens on, or 0 if not
   * running. Feed into `connect(server, { olcrtc: { socksPort } })`.
   */
  getOlcrtcSocksPort(): number {
    return NitroXrayCore.getOlcrtcSocksPort()
  },

  /** Whether the olcrtc client is currently running. */
  isOlcrtcRunning(): boolean {
    return NitroXrayCore.isOlcrtcRunning()
  },

  /**
   * Configure the persistent foreground VPN notification (Android): title,
   * body, Disconnect button label, kill-switch text, channel name. All fields
   * optional — set only what you translate; unset keeps the English default.
   * Call before connecting, and again to switch language at runtime. iOS: no-op.
   */
  setNotificationConfig(config: NotificationConfig): void {
    NitroXrayCore.setNotificationConfig(config)
  },

  /**
   * Set the VPN display name shown in iOS Settings → VPN (branding). Persisted;
   * applied on the next connect (and refreshed immediately if a profile exists).
   * Android: no-op — the system shows the app label. Default "Xray VPN".
   */
  setVpnName(name: string): void {
    NitroXrayCore.setVpnName(name)
  },

  /** Ensure the app has VPN permission, requesting it if needed. */
  async ensurePermission(): Promise<void> {
    const has = await NitroXrayCore.hasVpnPermission()
    if (!has) {
      await NitroXrayCore.requestVpnPermission()
    }
  },

  /**
   * Request the POST_NOTIFICATIONS permission (Android 13+). Required for the
   * foreground VPN notification to be visible — without it the service still
   * runs but its notification is suppressed. Resolves to whether it's granted.
   * No-op-ish on older Android / iOS (resolves true).
   */
  async requestNotificationPermission(): Promise<boolean> {
    return NitroXrayCore.requestNotificationPermission()
  },
}
