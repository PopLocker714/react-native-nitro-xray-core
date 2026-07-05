import { base64ToString, looksLikeBase64 } from './base64'
import type { Network, ParsedServer, Security, SubscriptionInfo } from './types'

/**
 * Parse a single share link into a {@link ParsedServer}.
 * Supports: vless://, vmess://, trojan://, ss:// (SIP002 + legacy base64).
 * Returns null for unknown schemes or malformed links.
 */
export function parseShareLink(uri: string): ParsedServer | null {
  const trimmed = uri.trim()
  const schemeIdx = trimmed.indexOf('://')
  if (schemeIdx === -1) return null
  const scheme = trimmed.slice(0, schemeIdx).toLowerCase()
  const afterScheme = trimmed.slice(schemeIdx + 3)

  try {
    switch (scheme) {
      case 'vless':
        return parseVless(afterScheme, trimmed)
      case 'trojan':
        return parseTrojan(afterScheme, trimmed)
      case 'vmess':
        return parseVmess(afterScheme, trimmed)
      case 'ss':
        return parseShadowsocks(afterScheme, trimmed)
      default:
        return null
    }
  } catch {
    return null
  }
}

/**
 * Parse a subscription payload into a list of servers. Accepts either a base64
 * blob (the common subscription format) or raw newline-separated share links.
 * Unparseable lines are skipped.
 */
export function parseSubscription(payload: string): ParsedServer[] {
  const text = looksLikeBase64(payload) ? base64ToString(payload) : payload
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => parseShareLink(line))
    .filter((server): server is ParsedServer => server !== null)
}

/**
 * Parse a `subscription-userinfo` header value into {@link SubscriptionInfo}.
 * Format: `upload=455727941; download=6174315083; total=1073741824000; expire=1719990770`
 * Keys are matched case-insensitively; unknown keys and non-numeric values are
 * skipped. Returns null when the input is missing or yields no known fields.
 */
export function parseSubscriptionUserInfo(
  header: string | null | undefined
): SubscriptionInfo | null {
  if (!header) return null
  const info: SubscriptionInfo = {}
  let found = false
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    const key = part.slice(0, eqIdx).trim().toLowerCase()
    const rawValue = part.slice(eqIdx + 1).trim()
    if (rawValue === '') continue // Number('') is 0 — an empty value is absent, not zero
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value < 0) continue // byte counters and expire are non-negative
    if (
      key === 'upload' ||
      key === 'download' ||
      key === 'total' ||
      key === 'expire'
    ) {
      info[key] = value
      found = true
    }
  }
  return found ? info : null
}

// --- Protocol parsers ---------------------------------------------------------

function parseVless(afterScheme: string, raw: string): ParsedServer | null {
  const parts = splitAuthorityLink(afterScheme)
  if (!parts || !parts.userinfo || parts.port === 0) return null
  return {
    protocol: 'vless',
    tag: parts.fragment || fallbackTag('vless', parts.host, parts.port),
    address: parts.host,
    port: parts.port,
    id: decodeComponentSafe(parts.userinfo),
    encryption: parts.query.encryption || 'none',
    ...streamFromQuery(parts.query, 'none'),
    raw,
  }
}

function parseTrojan(afterScheme: string, raw: string): ParsedServer | null {
  const parts = splitAuthorityLink(afterScheme)
  if (!parts || !parts.userinfo || parts.port === 0) return null
  return {
    protocol: 'trojan',
    tag: parts.fragment || fallbackTag('trojan', parts.host, parts.port),
    address: parts.host,
    port: parts.port,
    password: decodeComponentSafe(parts.userinfo),
    // trojan implies TLS unless the link explicitly says otherwise.
    ...streamFromQuery(parts.query, 'tls'),
    raw,
  }
}

interface VmessJson {
  v?: string | number
  ps?: string
  add?: string
  port?: string | number
  id?: string
  aid?: string | number
  scy?: string
  net?: string
  type?: string
  host?: string
  path?: string
  tls?: string
  sni?: string
  alpn?: string
  fp?: string
}

function parseVmess(afterScheme: string, raw: string): ParsedServer | null {
  // Strip a possible #fragment before base64-decoding the JSON payload.
  const hashIdx = afterScheme.indexOf('#')
  const payload = hashIdx === -1 ? afterScheme : afterScheme.slice(0, hashIdx)
  const json = JSON.parse(base64ToString(payload)) as VmessJson

  const address = json.add ?? ''
  const port = toPort(json.port)
  if (!address || port === 0) return null

  const net = (json.net || 'tcp') as Network
  const tls = json.tls || ''
  const security: Security =
    tls === 'reality' ? 'reality' : tls === 'tls' ? 'tls' : 'none'

  return {
    protocol: 'vmess',
    tag: json.ps || fallbackTag('vmess', address, port),
    address,
    port,
    id: json.id,
    alterId: toNumber(json.aid, 0),
    encryption: json.scy || 'auto',
    network: net,
    security,
    sni: json.sni || undefined,
    fingerprint: json.fp || undefined,
    alpn: splitCsv(json.alpn),
    // vmess encodes gRPC serviceName in `path`; ws/h2 path also live in `path`.
    path: net === 'grpc' ? undefined : json.path || undefined,
    serviceName: net === 'grpc' ? json.path || undefined : undefined,
    host: json.host || undefined,
    headerType: json.type || undefined,
    raw,
  }
}

function parseShadowsocks(afterScheme: string, raw: string): ParsedServer | null {
  // Split off #fragment (name).
  const hashIdx = afterScheme.indexOf('#')
  const fragment = hashIdx === -1 ? '' : decodeComponentSafe(afterScheme.slice(hashIdx + 1))
  let body = hashIdx === -1 ? afterScheme : afterScheme.slice(0, hashIdx)

  // Strip ?plugin=... (unused for now) before decoding.
  const qIdx = body.indexOf('?')
  if (qIdx !== -1) body = body.slice(0, qIdx)

  let method: string
  let password: string
  let host: string
  let port: number

  if (body.includes('@')) {
    // SIP002: ss://base64(method:password)@host:port
    const atIdx = body.lastIndexOf('@')
    const userinfo = body.slice(0, atIdx)
    const hostPort = body.slice(atIdx + 1)
    const creds = decodeUserinfoCreds(userinfo)
    if (!creds) return null
    method = creds.method
    password = creds.password
    const hp = splitHostPort(hostPort)
    host = hp.host
    port = hp.port
  } else {
    // Legacy: ss://base64(method:password@host:port)
    const decoded = base64ToString(body)
    const atIdx = decoded.lastIndexOf('@')
    if (atIdx === -1) return null
    const creds = splitFirst(decoded.slice(0, atIdx), ':')
    if (!creds) return null
    method = creds[0]
    password = creds[1]
    const hp = splitHostPort(decoded.slice(atIdx + 1))
    host = hp.host
    port = hp.port
  }

  if (!host || port === 0) return null

  return {
    protocol: 'shadowsocks',
    tag: fragment || fallbackTag('ss', host, port),
    address: host,
    port,
    method,
    password,
    network: 'tcp',
    security: 'none',
    raw,
  }
}

// --- Shared helpers -----------------------------------------------------------

interface AuthorityParts {
  userinfo: string
  host: string
  port: number
  query: Record<string, string>
  fragment: string
}

/** Split `userinfo@host:port/path?query#fragment` (path is ignored). */
function splitAuthorityLink(afterScheme: string): AuthorityParts | null {
  let rest = afterScheme

  let fragment = ''
  const hashIdx = rest.indexOf('#')
  if (hashIdx !== -1) {
    fragment = decodeComponentSafe(rest.slice(hashIdx + 1))
    rest = rest.slice(0, hashIdx)
  }

  let query: Record<string, string> = {}
  const qIdx = rest.indexOf('?')
  if (qIdx !== -1) {
    query = parseQuery(rest.slice(qIdx + 1))
    rest = rest.slice(0, qIdx)
  }

  let userinfo = ''
  const atIdx = rest.lastIndexOf('@')
  if (atIdx !== -1) {
    userinfo = rest.slice(0, atIdx)
    rest = rest.slice(atIdx + 1)
  }

  // Drop any trailing /path — the authority is everything up to the first slash.
  const slashIdx = rest.indexOf('/')
  if (slashIdx !== -1) rest = rest.slice(0, slashIdx)

  const { host, port } = splitHostPort(rest)
  if (!host) return null
  return { userinfo, host, port, query, fragment }
}

function streamFromQuery(
  query: Record<string, string>,
  defaultSecurity: Security
): Pick<
  ParsedServer,
  | 'network'
  | 'security'
  | 'sni'
  | 'fingerprint'
  | 'alpn'
  | 'publicKey'
  | 'shortId'
  | 'spiderX'
  | 'path'
  | 'host'
  | 'serviceName'
  | 'headerType'
  | 'flow'
> {
  const network = (query.type || 'tcp') as Network
  const security = (query.security || defaultSecurity) as Security
  return {
    network,
    security,
    sni: query.sni || query.peer || undefined,
    fingerprint: query.fp || undefined,
    alpn: splitCsv(query.alpn),
    publicKey: query.pbk || undefined,
    shortId: query.sid || undefined,
    spiderX: query.spx || undefined,
    path: query.path || undefined,
    host: query.host || undefined,
    serviceName: query.serviceName || undefined,
    headerType: query.headerType || undefined,
    flow: query.flow || undefined,
  }
}

function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of query.split('&')) {
    if (!pair) continue
    const eqIdx = pair.indexOf('=')
    const key = eqIdx === -1 ? pair : pair.slice(0, eqIdx)
    const value = eqIdx === -1 ? '' : pair.slice(eqIdx + 1)
    out[decodeComponentSafe(key)] = decodeComponentSafe(value)
  }
  return out
}

function splitHostPort(hostPort: string): { host: string; port: number } {
  if (hostPort.startsWith('[')) {
    // IPv6 literal: [::1]:443
    const close = hostPort.indexOf(']')
    if (close === -1) return { host: hostPort, port: 0 }
    const host = hostPort.slice(1, close)
    const portStr = hostPort.slice(close + 1).replace(/^:/, '')
    return { host, port: toPort(portStr) }
  }
  const idx = hostPort.lastIndexOf(':')
  if (idx === -1) return { host: hostPort, port: 0 }
  return { host: hostPort.slice(0, idx), port: toPort(hostPort.slice(idx + 1)) }
}

function decodeUserinfoCreds(
  userinfo: string
): { method: string; password: string } | null {
  // SIP002 userinfo is base64(method:password); some emitters percent-encode it.
  const candidates = [tryBase64(userinfo), decodeComponentSafe(userinfo)]
  for (const candidate of candidates) {
    const pair = splitFirst(candidate, ':')
    if (pair && pair[0]) return { method: pair[0], password: pair[1] }
  }
  return null
}

function splitFirst(input: string, sep: string): [string, string] | null {
  const idx = input.indexOf(sep)
  if (idx === -1) return null
  return [input.slice(0, idx), input.slice(idx + 1)]
}

function tryBase64(input: string): string {
  try {
    return base64ToString(input)
  } catch {
    return ''
  }
}

function decodeComponentSafe(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return parts.length > 0 ? parts : undefined
}

function toPort(value: string | number | undefined): number {
  return toNumber(value, 0)
}

function toNumber(value: string | number | undefined, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

function fallbackTag(protocol: string, host: string, port: number): string {
  return `${protocol}-${host}:${port}`
}
