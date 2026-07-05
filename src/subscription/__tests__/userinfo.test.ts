import { describe, expect, test } from 'bun:test'
import { parseSubscriptionUserInfo } from '../parse'

describe('parseSubscriptionUserInfo', () => {
  test('parses the canonical four-field header', () => {
    const info = parseSubscriptionUserInfo(
      'upload=455727941; download=6174315083; total=1073741824000; expire=1719990770'
    )
    expect(info).toEqual({
      upload: 455727941,
      download: 6174315083,
      total: 1073741824000,
      expire: 1719990770,
    })
  })

  test('returns null for null, undefined and empty input', () => {
    expect(parseSubscriptionUserInfo(null)).toBeNull()
    expect(parseSubscriptionUserInfo(undefined)).toBeNull()
    expect(parseSubscriptionUserInfo('')).toBeNull()
  })

  test('returns null for garbage without known keys', () => {
    expect(parseSubscriptionUserInfo('hello world')).toBeNull()
    expect(parseSubscriptionUserInfo('foo=1; bar=2')).toBeNull()
  })

  test('tolerates a missing field (no expire)', () => {
    const info = parseSubscriptionUserInfo(
      'upload=100; download=200; total=300'
    )
    expect(info).toEqual({ upload: 100, download: 200, total: 300 })
    expect(info?.expire).toBeUndefined()
  })

  test('is whitespace-tolerant and case-insensitive', () => {
    const info = parseSubscriptionUserInfo(
      '  Upload = 1 ;DOWNLOAD=2;  Total=3 ; EXPIRE=4  '
    )
    expect(info).toEqual({ upload: 1, download: 2, total: 3, expire: 4 })
  })

  test('ignores unknown keys but keeps known ones', () => {
    const info = parseSubscriptionUserInfo(
      'upload=10; reset_day=5; download=20; plan=pro'
    )
    expect(info).toEqual({ upload: 10, download: 20 })
  })

  test('skips non-numeric values without poisoning the rest', () => {
    const info = parseSubscriptionUserInfo(
      'upload=abc; download=42; expire='
    )
    expect(info).toEqual({ download: 42 })
  })
})
