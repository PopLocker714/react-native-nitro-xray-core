/**
 * Connection params for the olcrtc WebRTC side-channel client. Serialized to
 * JSON and passed to the native `startOlcrtc`. Distinct from
 * `OlcrtcChainOptions` (config/build), which only wires xray's `dialerProxy`
 * to an already-running olcrtc SOCKS5 listener.
 *
 * These usually come from an olcrtc client URI / subscription entry.
 */
export interface OlcrtcClientConfig {
  /** Carrier name: 'telemost', 'wbstream', 'jitsi', ... */
  carrier: string
  /** Carrier-specific room ID. */
  roomId: string
  /** Client identifier; must match the server's `-client-id`. */
  clientId: string
  /** 64-char hex encryption key. */
  keyHex: string
  /** Local SOCKS5 port to listen on. Default 10808 (native side). */
  socksPort?: number
  /** SOCKS5 auth username (empty = no auth). */
  socksUser?: string
  /** SOCKS5 auth password. */
  socksPass?: string
  /** Bind host for the SOCKS listener. Default '127.0.0.1'. */
  socksHost?: string
  /** DNS server for the olcrtc tunnel, e.g. '8.8.8.8:53'. */
  dnsServer?: string
  /** Transport override: 'vp8channel' (default) or 'datachannel'. */
  transport?: string
  /** Max wait for the SOCKS listener to become ready, ms. Default 15000. */
  readyTimeoutMs?: number
}
