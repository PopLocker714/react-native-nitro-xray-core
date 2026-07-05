/**
 * Environment-independent base64 decoding.
 *
 * We avoid `atob`/`Buffer`/`TextDecoder` because their availability differs
 * across the React Native (Hermes) runtime, Node, and Bun. This decoder
 * handles both standard and URL-safe base64, tolerates missing padding, and
 * decodes the resulting bytes as UTF-8 (share links routinely carry non-ASCII
 * server names in the vmess payload and #fragment).
 */

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const B64_LOOKUP: Record<string, number> = {}
for (let i = 0; i < B64_ALPHABET.length; i++) {
  B64_LOOKUP[B64_ALPHABET.charAt(i)] = i
}

/** Decode a (possibly URL-safe, possibly unpadded) base64 string to bytes. */
export function base64ToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
  const clean = normalized.replace(/=+$/, '')

  const byteLength = Math.floor((clean.length * 6) / 8)
  const bytes = new Uint8Array(byteLength)

  let bitBuffer = 0
  let bitCount = 0
  let byteIndex = 0

  for (let i = 0; i < clean.length; i++) {
    const value = B64_LOOKUP[clean.charAt(i)]
    if (value === undefined) continue // skip stray characters
    bitBuffer = (bitBuffer << 6) | value
    bitCount += 6
    if (bitCount >= 8) {
      bitCount -= 8
      bytes[byteIndex++] = (bitBuffer >> bitCount) & 0xff
    }
  }

  return byteIndex === bytes.length ? bytes : bytes.subarray(0, byteIndex)
}

/** Decode base64 to a UTF-8 string. */
export function base64ToString(input: string): string {
  return utf8Decode(base64ToBytes(input))
}

/** Minimal UTF-8 byte decoder (no TextDecoder dependency). */
function utf8Decode(bytes: Uint8Array): string {
  let result = ''
  let i = 0
  while (i < bytes.length) {
    const byte1 = bytes[i++] as number
    if (byte1 < 0x80) {
      result += String.fromCharCode(byte1)
    } else if (byte1 >= 0xc0 && byte1 < 0xe0) {
      const byte2 = bytes[i++] as number
      result += String.fromCharCode(((byte1 & 0x1f) << 6) | (byte2 & 0x3f))
    } else if (byte1 >= 0xe0 && byte1 < 0xf0) {
      const byte2 = bytes[i++] as number
      const byte3 = bytes[i++] as number
      result += String.fromCharCode(
        ((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f)
      )
    } else {
      // 4-byte sequence → surrogate pair
      const byte2 = bytes[i++] as number
      const byte3 = bytes[i++] as number
      const byte4 = bytes[i++] as number
      const codePoint =
        ((byte1 & 0x07) << 18) |
        ((byte2 & 0x3f) << 12) |
        ((byte3 & 0x3f) << 6) |
        (byte4 & 0x3f)
      const offset = codePoint - 0x10000
      result += String.fromCharCode(
        0xd800 + (offset >> 10),
        0xdc00 + (offset & 0x3ff)
      )
    }
  }
  return result
}

/**
 * Heuristic: is this string a base64 blob (a whole-subscription payload) rather
 * than newline-separated share links? Subscriptions are commonly delivered as a
 * single base64 document.
 */
export function looksLikeBase64(input: string): boolean {
  const trimmed = input.trim()
  if (trimmed.includes('://')) return false
  return /^[A-Za-z0-9+/\-_=\s]+$/.test(trimmed) && trimmed.length > 0
}
