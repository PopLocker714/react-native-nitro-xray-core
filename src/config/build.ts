import type { ParsedServer } from '../subscription/types'

/**
 * Chain the proxy outbound through a local olcrtc SOCKS5 hop (the "Russia
 * bypass" path). The server handshake itself rides inside olcrtc's WebRTC
 * side-channel, so the carrier only sees whitelisted WebRTC traffic.
 *
 * This is pure config: xray dials the proxy outbound via
 * `streamSettings.sockopt.dialerProxy`, which points at a `socks` outbound
 * targeting olcrtc's local listener. No native glue is needed as long as
 * olcrtc is already up and listening on `socksHost:socksPort`.
 */
export interface OlcrtcChainOptions {
  /** Local SOCKS5 port olcrtc listens on (from `getOlcrtcSocksPort()`). */
  socksPort: number
  /** Host olcrtc's SOCKS5 binds to. Default '127.0.0.1'. */
  socksHost?: string
  /** Outbound tag for the olcrtc socks hop. Default 'olcrtc-out'. */
  tag?: string
}

/** Options controlling how a full Xray config is assembled from a server. */
export interface BuildConfigOptions {
  /** Outbound tag for the proxy. Must match the tag queried by getStats(). Default 'proxy'. */
  proxyTag?: string
  /** Xray DNS servers. Default ['1.1.1.1', 'localhost']. */
  dns?: string[]
  /** TUN interface name. Default 'tun0'. */
  tunName?: string
  /** MTU for the TUN inbound. Default 1500. */
  mtu?: number
  /** Xray log level. Default 'warning'. */
  logLevel?: string
  /** Emit stats+policy blocks so getStats() works. Default true. */
  enableStats?: boolean
  /** Route the proxy outbound through a local olcrtc SOCKS5 hop. */
  olcrtc?: OlcrtcChainOptions
}

const PRIVATE_RANGES = [
  '127.0.0.1/32',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  'fc00::/7',
  'fe80::/10',
]

/**
 * Build a complete Xray JSON config object from a normalized server.
 * The returned object is ready to `JSON.stringify()` and pass to `startXray`.
 */
export function buildXrayConfig(
  server: ParsedServer,
  options: BuildConfigOptions = {}
): Record<string, unknown> {
  const proxyTag = options.proxyTag ?? 'proxy'
  const dns = options.dns ?? ['1.1.1.1', 'localhost']
  const tunName = options.tunName ?? 'tun0'
  const mtu = options.mtu ?? 1500
  const logLevel = options.logLevel ?? 'warning'
  const enableStats = options.enableStats ?? true
  const olcrtcTag = options.olcrtc ? (options.olcrtc.tag ?? 'olcrtc-out') : null

  const outbounds: Record<string, unknown>[] = [
    buildOutbound(server, proxyTag, olcrtcTag),
    { protocol: 'freedom', tag: 'direct' },
    { protocol: 'blackhole', tag: 'block' },
    { protocol: 'dns', tag: 'dns-out' },
  ]
  if (options.olcrtc && olcrtcTag) {
    outbounds.push(buildOlcrtcOutbound(options.olcrtc, olcrtcTag))
  }

  const config: Record<string, unknown> = {
    log: { loglevel: logLevel },
    inbounds: [
      {
        tag: 'tun-in',
        protocol: 'tun',
        port: 0,
        settings: { name: tunName, mtu },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
      },
    ],
    outbounds,
    dns: { servers: dns },
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        { type: 'field', port: 53, outboundTag: 'dns-out' },
        { type: 'field', ip: PRIVATE_RANGES, outboundTag: 'direct' },
        { type: 'field', inboundTag: ['tun-in'], outboundTag: proxyTag },
      ],
    },
  }

  if (enableStats) {
    config.stats = {}
    config.policy = {
      levels: { '0': { statsUserUplink: true, statsUserDownlink: true } },
      system: {
        statsInboundUplink: true,
        statsInboundDownlink: true,
        statsOutboundUplink: true,
        statsOutboundDownlink: true,
      },
    }
  }

  return config
}

/** Options for {@link buildOlcrtcTunnelConfig}. */
export interface OlcrtcTunnelOptions {
  /** Local SOCKS5 port olcrtc listens on (from `getOlcrtcSocksPort()`). */
  socksPort: number
  /** Host olcrtc's SOCKS5 binds to. Default '127.0.0.1'. */
  socksHost?: string
  /** Outbound tag for the olcrtc hop (also the getStats tag). Default 'proxy'. */
  proxyTag?: string
  /** Xray DNS servers. Default ['1.1.1.1', 'localhost']. */
  dns?: string[]
  /** TUN interface name. Default 'tun0'. */
  tunName?: string
  /** MTU for the TUN inbound. Default 1500. */
  mtu?: number
  /** Xray log level. Default 'warning'. */
  logLevel?: string
  /** Emit stats+policy blocks so getStats() works. Default true. */
  enableStats?: boolean
}

/**
 * Build an "olcrtc-only" Xray config: TUN inbound routed straight into a
 * `socks` outbound pointing at olcrtc's local SOCKS5 — no VLESS/vmess/etc.
 * server. All device traffic goes TUN → olcrtc → your olcrtc server → internet.
 * xray is used purely as the TUN↔SOCKS plumbing here.
 *
 * olcrtc must already be running (start it first, then pass its SOCKS port).
 */
export function buildOlcrtcTunnelConfig(
  options: OlcrtcTunnelOptions
): Record<string, unknown> {
  const proxyTag = options.proxyTag ?? 'proxy'
  const socksHost = options.socksHost ?? '127.0.0.1'
  const dns = options.dns ?? ['1.1.1.1', 'localhost']
  const tunName = options.tunName ?? 'tun0'
  const mtu = options.mtu ?? 1500
  const logLevel = options.logLevel ?? 'warning'
  const enableStats = options.enableStats ?? true

  const config: Record<string, unknown> = {
    log: { loglevel: logLevel },
    inbounds: [
      {
        tag: 'tun-in',
        protocol: 'tun',
        port: 0,
        settings: { name: tunName, mtu },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
      },
    ],
    outbounds: [
      {
        tag: proxyTag,
        protocol: 'socks',
        settings: { servers: [{ address: socksHost, port: options.socksPort }] },
      },
      { protocol: 'freedom', tag: 'direct' },
      { protocol: 'blackhole', tag: 'block' },
      { protocol: 'dns', tag: 'dns-out' },
    ],
    dns: { servers: dns },
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        { type: 'field', port: 53, outboundTag: 'dns-out' },
        { type: 'field', ip: PRIVATE_RANGES, outboundTag: 'direct' },
        { type: 'field', inboundTag: ['tun-in'], outboundTag: proxyTag },
      ],
    },
  }

  if (enableStats) {
    config.stats = {}
    config.policy = {
      levels: { '0': { statsUserUplink: true, statsUserDownlink: true } },
      system: {
        statsInboundUplink: true,
        statsInboundDownlink: true,
        statsOutboundUplink: true,
        statsOutboundDownlink: true,
      },
    }
  }

  return config
}

function buildOutbound(
  server: ParsedServer,
  tag: string,
  dialerProxyTag: string | null
): Record<string, unknown> {
  return {
    tag,
    protocol: xrayProtocol(server.protocol),
    settings: buildSettings(server),
    streamSettings: buildStreamSettings(server, dialerProxyTag),
  }
}

/**
 * A `socks` outbound pointing at olcrtc's local SOCKS5 listener. The proxy
 * outbound's `sockopt.dialerProxy` references this tag, so xray dials the
 * server through olcrtc instead of the raw network.
 */
function buildOlcrtcOutbound(
  olcrtc: OlcrtcChainOptions,
  tag: string
): Record<string, unknown> {
  return {
    tag,
    protocol: 'socks',
    settings: {
      servers: [{ address: olcrtc.socksHost ?? '127.0.0.1', port: olcrtc.socksPort }],
    },
  }
}

function xrayProtocol(protocol: ParsedServer['protocol']): string {
  return protocol === 'shadowsocks' ? 'shadowsocks' : protocol
}

function buildSettings(server: ParsedServer): Record<string, unknown> {
  switch (server.protocol) {
    case 'vless':
      return {
        vnext: [
          {
            address: server.address,
            port: server.port,
            users: [
              omitUndefined({
                id: server.id,
                encryption: server.encryption ?? 'none',
                flow: server.flow,
              }),
            ],
          },
        ],
      }
    case 'vmess':
      return {
        vnext: [
          {
            address: server.address,
            port: server.port,
            users: [
              omitUndefined({
                id: server.id,
                alterId: server.alterId ?? 0,
                security: server.encryption ?? 'auto',
              }),
            ],
          },
        ],
      }
    case 'trojan':
      return {
        servers: [
          omitUndefined({
            address: server.address,
            port: server.port,
            password: server.password,
            flow: server.flow,
          }),
        ],
      }
    case 'shadowsocks':
      return {
        servers: [
          omitUndefined({
            address: server.address,
            port: server.port,
            method: server.method,
            password: server.password,
          }),
        ],
      }
  }
}

function buildStreamSettings(
  server: ParsedServer,
  dialerProxyTag: string | null
): Record<string, unknown> {
  const stream: Record<string, unknown> = {
    network: server.network,
    security: server.security,
  }

  // Chain this outbound's transport through olcrtc's local SOCKS5 hop.
  if (dialerProxyTag) {
    stream.sockopt = { dialerProxy: dialerProxyTag }
  }

  if (server.security === 'tls') {
    stream.tlsSettings = omitUndefined({
      serverName: server.sni,
      fingerprint: server.fingerprint,
      alpn: server.alpn,
    })
  } else if (server.security === 'reality') {
    stream.realitySettings = omitUndefined({
      show: false,
      serverName: server.sni,
      fingerprint: server.fingerprint,
      publicKey: server.publicKey,
      shortId: server.shortId,
      spiderX: server.spiderX,
    })
  }

  const transport = buildTransportSettings(server)
  if (transport) {
    stream[transport.key] = transport.value
  }

  return stream
}

function buildTransportSettings(
  server: ParsedServer
): { key: string; value: Record<string, unknown> } | null {
  switch (server.network) {
    case 'ws':
      return {
        key: 'wsSettings',
        value: omitUndefined({
          path: server.path ?? '/',
          headers: server.host ? { Host: server.host } : undefined,
        }),
      }
    case 'httpupgrade':
      return {
        key: 'httpupgradeSettings',
        value: omitUndefined({ path: server.path ?? '/', host: server.host }),
      }
    case 'xhttp':
      return {
        key: 'xhttpSettings',
        value: omitUndefined({ path: server.path ?? '/', host: server.host }),
      }
    case 'grpc':
      return {
        key: 'grpcSettings',
        value: omitUndefined({ serviceName: server.serviceName ?? '' }),
      }
    case 'h2':
      return {
        key: 'httpSettings',
        value: omitUndefined({
          path: server.path ?? '/',
          host: server.host ? [server.host] : undefined,
        }),
      }
    case 'kcp':
      return {
        key: 'kcpSettings',
        value: { header: { type: server.headerType ?? 'none' } },
      }
    case 'tcp':
      // Only emit tcpSettings when an http header obfuscation is requested.
      if (server.headerType === 'http') {
        return {
          key: 'tcpSettings',
          value: {
            header: omitUndefined({
              type: 'http',
              request: server.host
                ? { headers: { Host: [server.host] } }
                : undefined,
            }),
          },
        }
      }
      return null
    default:
      return null
  }
}

/** Drop keys whose value is undefined so the emitted JSON stays clean. */
function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) out[key] = obj[key]
  }
  return out as T
}
