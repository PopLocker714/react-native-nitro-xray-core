import { describe, expect, test } from 'bun:test'
import { urlTest } from '../urltest'
import type { ParsedServer } from '../../subscription/types'

function server(tag: string, address = 'example.com', port = 443): ParsedServer {
  return {
    protocol: 'vless',
    tag,
    address,
    port,
    network: 'tcp',
    security: 'tls',
    raw: `vless://uuid@${address}:${port}#${tag}`,
  }
}

function fetchStub(
  plan: Record<string, { delayMs: number; fail?: boolean; hang?: boolean }>
): typeof fetch {
  return ((url: any, init?: any) =>
    new Promise((resolve, reject) => {
      const entry = plan[String(url)]
      if (!entry) {
        reject(new TypeError('Network request failed'))
        return
      }
      const signal: AbortSignal | undefined = init?.signal
      if (entry.hang) {
        // Never settles on its own — only the caller's abort ends it.
        signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        )
        return
      }
      setTimeout(() => {
        if (entry.fail) reject(new TypeError('Network request failed'))
        else resolve(new Response(null, { status: 200 }))
      }, entry.delayMs)
    })) as typeof fetch
}

describe('urlTest', () => {
  test('sorts by latency ascending', async () => {
    const servers = [server('slow', 'a.com'), server('fast', 'b.com')]
    const results = await urlTest(servers, {
      fetchFn: fetchStub({
        'http://a.com:443': { delayMs: 120 },
        'http://b.com:443': { delayMs: 10 },
      }),
    })
    expect(results.map((r) => r.server.tag)).toEqual(['fast', 'slow'])
    expect(results[0]!.latencyMs).not.toBeNull()
    expect(results[0]!.latencyMs!).toBeLessThan(results[1]!.latencyMs!)
  })

  test('a fast network error still counts as reachable latency', async () => {
    const results = await urlTest([server('tls-server', 'c.com')], {
      fetchFn: fetchStub({ 'http://c.com:443': { delayMs: 15, fail: true } }),
    })
    expect(results[0]!.latencyMs).not.toBeNull()
  })

  test('timeout yields null and sorts last', async () => {
    const servers = [server('dead', 'dead.com'), server('alive', 'ok.com')]
    const results = await urlTest(servers, {
      timeoutMs: 50,
      fetchFn: fetchStub({
        'http://dead.com:443': { delayMs: 0, hang: true },
        'http://ok.com:443': { delayMs: 5 },
      }),
    })
    expect(results.map((r) => r.server.tag)).toEqual(['alive', 'dead'])
    expect(results[1]!.latencyMs).toBeNull()
  })

  test('respects the concurrency cap while measuring every server', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const fetchFn = ((url: any, init?: any) =>
      new Promise((resolve) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        setTimeout(() => {
          inFlight--
          resolve(new Response(null, { status: 200 }))
        }, 10)
      })) as typeof fetch

    const servers = Array.from({ length: 10 }, (_, i) =>
      server(`s${i}`, `host${i}.com`)
    )
    const results = await urlTest(servers, { concurrency: 3, fetchFn })
    expect(results).toHaveLength(10)
    expect(results.every((r) => r.latencyMs !== null)).toBe(true)
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  test('empty server list returns empty result', async () => {
    expect(await urlTest([])).toEqual([])
  })

  test('custom probeUrl is used', async () => {
    const seen: string[] = []
    const fetchFn = ((url: any) => {
      seen.push(String(url))
      return Promise.resolve(new Response(null, { status: 204 }))
    }) as typeof fetch
    await urlTest([server('x', 'h.com', 8443)], {
      probeUrl: (s) => `https://${s.address}:${s.port}/health`,
      fetchFn,
    })
    expect(seen).toEqual(['https://h.com:8443/health'])
  })
})
