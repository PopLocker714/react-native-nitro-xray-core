import { describe, expect, it } from 'bun:test'
import { XrayError, toXrayError } from '../errors'

describe('toXrayError', () => {
  it('parses a native "CODE|message" rejection into a typed error', () => {
    const err = toXrayError(new Error('OLCRTC_NOT_READY|SOCKS not ready in time'))
    expect(err).toBeInstanceOf(XrayError)
    expect(err.code).toBe('OLCRTC_NOT_READY')
    expect(err.message).toBe('SOCKS not ready in time')
    expect(err.retryable).toBe(true)
  })

  it('marks fatal codes as non-retryable', () => {
    const err = toXrayError(new Error('OLCRTC_INVALID_CONFIG|bad json'))
    expect(err.code).toBe('OLCRTC_INVALID_CONFIG')
    expect(err.retryable).toBe(false)
  })

  it('falls back to the given code for an untagged message', () => {
    const err = toXrayError(new Error('some native failure'), 'ENGINE_START_FAILED')
    expect(err.code).toBe('ENGINE_START_FAILED')
    expect(err.message).toBe('some native failure')
  })

  it('defaults to UNKNOWN with no fallback', () => {
    expect(toXrayError('weird').code).toBe('UNKNOWN')
    expect(toXrayError(new Error('x')).code).toBe('UNKNOWN')
  })

  it('ignores an unknown code prefix and uses the fallback', () => {
    const err = toXrayError(new Error('BOGUS_CODE|msg'), 'ENGINE_START_FAILED')
    expect(err.code).toBe('ENGINE_START_FAILED')
    // whole message preserved when the prefix isn't a known code
    expect(err.message).toBe('BOGUS_CODE|msg')
  })

  it('passes an existing XrayError through unchanged', () => {
    const original = new XrayError('PERMISSION_DENIED', 'denied')
    expect(toXrayError(original)).toBe(original)
  })

  it('instanceof works across the prototype restore', () => {
    const err = new XrayError('SUBSCRIPTION_TIMEOUT', 'timeout')
    expect(err instanceof XrayError).toBe(true)
    expect(err instanceof Error).toBe(true)
    expect(err.retryable).toBe(true)
  })
})
