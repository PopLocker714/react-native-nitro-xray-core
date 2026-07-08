import { describe, expect, it } from 'bun:test'
import { createSerialLock } from '../lock'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('createSerialLock', () => {
  it('runs operations strictly in order, never overlapping', async () => {
    const withLock = createSerialLock()
    const events: string[] = []
    const op = (name: string, ms: number) =>
      withLock(async () => {
        events.push(`${name}:start`)
        await tick(ms)
        events.push(`${name}:end`)
      })

    // B starts before A finishes in wall-clock, but the lock must serialize them.
    const a = op('A', 30)
    const b = op('B', 5)
    await Promise.all([a, b])

    expect(events).toEqual(['A:start', 'A:end', 'B:start', 'B:end'])
  })

  it('a rejected op does not break the chain', async () => {
    const withLock = createSerialLock()
    const order: string[] = []

    const failing = withLock(async () => {
      order.push('fail:start')
      throw new Error('boom')
    })
    const next = withLock(async () => {
      order.push('next:start')
      return 'ok'
    })

    await expect(failing).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ok')
    expect(order).toEqual(['fail:start', 'next:start'])
  })

  it('propagates the op result and preserves per-call return values', async () => {
    const withLock = createSerialLock()
    const r1 = await withLock(async () => 1)
    const r2 = await withLock(async () => 'two')
    expect(r1).toBe(1)
    expect(r2).toBe('two')
  })

  it('serializes a connect-then-disconnect pair (no interleave)', async () => {
    const withLock = createSerialLock()
    const log: string[] = []
    // connect is slow; disconnect is queued behind it and runs only after.
    const connect = withLock(async () => {
      log.push('connect:begin')
      await tick(20)
      log.push('connect:done')
    })
    const disconnect = withLock(async () => {
      log.push('disconnect:begin')
      await tick(1)
      log.push('disconnect:done')
    })
    await Promise.all([connect, disconnect])
    expect(log).toEqual([
      'connect:begin',
      'connect:done',
      'disconnect:begin',
      'disconnect:done',
    ])
  })
})
