/**
 * Normalized, transport-agnostic representation of a single proxy server
 * parsed from a share link (vless://, vmess://, ss://, trojan://).
 *
 * This is the intermediate form: parsers produce it, the config builder
 * consumes it. It intentionally mirrors the union of fields the supported
 * protocols/transports need, rather than any single Xray schema shape.
 */
export type ProxyProtocol = 'vless' | 'vmess' | 'trojan' | 'shadowsocks'

export type Network =
  | 'tcp'
  | 'ws'
  | 'grpc'
  | 'httpupgrade'
  | 'xhttp'
  | 'kcp'
  | 'h2'

export type Security = 'none' | 'tls' | 'reality'

/**
 * Account quota/expiry info reported by a subscription server via the
 * `subscription-userinfo` response header (Clash/V2Ray ecosystem convention):
 * `upload=455727941; download=6174315083; total=1073741824000; expire=1719990770`
 *
 * All fields are optional — servers send any subset. Byte counters are raw
 * bytes; `expire` is a unix timestamp in seconds.
 *
 * Ecosystem convention: `total=0` means unlimited quota and `expire=0` means
 * no expiry — treat zero as "unset" at the display layer, don't render it
 * as a literal 0-byte quota or a 1970 date.
 */
export interface SubscriptionInfo {
  /** Bytes uploaded against the quota. */
  upload?: number
  /** Bytes downloaded against the quota. */
  download?: number
  /** Total quota in bytes. */
  total?: number
  /** Expiry as unix timestamp (seconds). */
  expire?: number
}

export interface ParsedServer {
  protocol: ProxyProtocol
  /** Display name from the URL fragment (#...), or a generated fallback. */
  tag: string
  address: string
  port: number

  // Auth
  /** UUID for vless/vmess. */
  id?: string
  /** Password for trojan / shadowsocks. */
  password?: string
  /** Cipher method for shadowsocks. */
  method?: string
  /** vmess alterId (legacy). */
  alterId?: number
  /** vless: 'none'; vmess security (scy): 'auto' | 'aes-128-gcm' | ... */
  encryption?: string
  /** vless flow, e.g. 'xtls-rprx-vision'. */
  flow?: string

  // Stream / transport
  network: Network
  security: Security
  sni?: string
  fingerprint?: string
  alpn?: string[]

  // Reality
  publicKey?: string
  shortId?: string
  spiderX?: string

  // Transport-specific
  /** Path for ws / httpupgrade / xhttp / h2. */
  path?: string
  /** Host header for ws / h2 (may be comma-separated upstream). */
  host?: string
  /** serviceName for gRPC. */
  serviceName?: string
  /** headerType for tcp/kcp (e.g. 'http', 'none'). */
  headerType?: string

  /** Original share link, preserved for debugging / round-trips. */
  raw: string
}
