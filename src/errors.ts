/**
 * Stable, machine-readable error codes so callers can branch on the failure
 * kind (retry vs. give up vs. ask the user) instead of string-matching a
 * localized message that differs across platforms.
 */
export type XrayErrorCode =
  | 'OLCRTC_INVALID_CONFIG' // malformed olcrtc client config — fatal
  | 'OLCRTC_START_FAILED' // olcrtc engine failed to start — usually transient
  | 'OLCRTC_NOT_READY' // SOCKS listener didn't come up in time — retry
  | 'ENGINE_START_FAILED' // xray/tunnel failed to start
  | 'PERMISSION_DENIED' // user declined the VPN permission
  | 'SUBSCRIPTION_TIMEOUT' // subscription fetch timed out — retry
  | 'SUBSCRIPTION_HTTP_ERROR' // subscription server returned non-2xx
  | 'UNKNOWN'

const RETRYABLE: ReadonlySet<XrayErrorCode> = new Set([
  'OLCRTC_START_FAILED',
  'OLCRTC_NOT_READY',
  'SUBSCRIPTION_TIMEOUT',
])

/** A typed error thrown by {@link XrayClient} operations. */
export class XrayError extends Error {
  readonly code: XrayErrorCode
  /** Whether retrying the same operation could plausibly succeed. */
  readonly retryable: boolean

  constructor(code: XrayErrorCode, message: string) {
    super(message)
    this.name = 'XrayError'
    this.code = code
    this.retryable = RETRYABLE.has(code)
    // Restore the prototype chain (TS→ES5 extends-builtin caveat).
    Object.setPrototypeOf(this, XrayError.prototype)
  }
}

const KNOWN_CODES = new Set<string>([
  'OLCRTC_INVALID_CONFIG',
  'OLCRTC_START_FAILED',
  'OLCRTC_NOT_READY',
  'ENGINE_START_FAILED',
  'PERMISSION_DENIED',
  'SUBSCRIPTION_TIMEOUT',
  'SUBSCRIPTION_HTTP_ERROR',
  'UNKNOWN',
])

/**
 * Normalize any thrown value into an {@link XrayError}. Native rejections carry
 * a `"CODE|message"` prefix (see the Kotlin/Swift sides); everything else falls
 * back to `UNKNOWN` with the original message preserved.
 */
export function toXrayError(e: unknown, fallback: XrayErrorCode = 'UNKNOWN'): XrayError {
  if (e instanceof XrayError) return e
  const msg = e instanceof Error ? e.message : String(e)
  const sep = msg.indexOf('|')
  if (sep > 0) {
    const code = msg.slice(0, sep)
    if (KNOWN_CODES.has(code)) {
      return new XrayError(code as XrayErrorCode, msg.slice(sep + 1))
    }
  }
  return new XrayError(fallback, msg)
}
