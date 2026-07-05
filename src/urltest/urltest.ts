import type { ParsedServer } from '../subscription/types'

/** Result of probing one server. `latencyMs` is null when unreachable. */
export interface UrlTestResult {
  server: ParsedServer
  /** Milliseconds until the probe settled, or null on timeout/failure. */
  latencyMs: number | null
}

export interface UrlTestOptions {
  /** Per-server probe timeout in ms. Default 3000. */
  timeoutMs?: number
  /** Max simultaneous probes. Default 8. */
  concurrency?: number
  /**
   * Build the probe URL for a server. Default `http://{address}:{port}`.
   * Override to probe through a known endpoint (e.g. an https health URL).
   */
  probeUrl?: (server: ParsedServer) => string
  /** Injectable fetch for testing. Default global fetch. */
  fetchFn?: typeof fetch
}

/**
 * MVP reachability probe (plan stage 3.2): measures how fast each server
 * answers an HTTP request to `address:port` and sorts the list by latency.
 *
 * Semantics — reachability-grade, not proxy throughput:
 * - Most proxy servers speak TLS/VLESS on that port, so the HTTP probe is
 *   expected to FAIL at the protocol level. What we measure is the time for
 *   the fetch to settle (response OR fast network error) — dominated by
 *   DNS + TCP handshake RTT, which is exactly the ranking signal we want.
 * - Only a timeout counts as unreachable (`latencyMs: null`).
 * - Real through-the-proxy measurement (xray observatory) is the planned V2.
 */
export async function urlTest(
  servers: ParsedServer[],
  options: UrlTestOptions = {}
): Promise<UrlTestResult[]> {
  const timeoutMs = options.timeoutMs ?? 3000
  const concurrency = Math.max(1, options.concurrency ?? 8)
  const probeUrl =
    options.probeUrl ?? ((s: ParsedServer) => `http://${s.address}:${s.port}`)
  const fetchFn = options.fetchFn ?? fetch

  const results: UrlTestResult[] = new Array(servers.length)
  let next = 0

  async function worker(): Promise<void> {
    while (next < servers.length) {
      const index = next++
      const server = servers[index]!
      results[index] = {
        server,
        latencyMs: await measure(probeUrl(server), timeoutMs, fetchFn),
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, servers.length) },
    () => worker()
  )
  await Promise.all(workers)

  // Stable sort: fastest first, unreachable (null) last, ties keep input order.
  return results
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const la = a.r.latencyMs
      const lb = b.r.latencyMs
      if (la === null && lb === null) return a.i - b.i
      if (la === null) return 1
      if (lb === null) return -1
      return la - lb || a.i - b.i
    })
    .map(({ r }) => r)
}

// Monotonic clock when available — Date.now() can jump on system clock
// adjustments and produce negative "latencies" that sort as fastest.
const perf = (globalThis as { performance?: { now(): number } }).performance
const now: () => number =
  perf && typeof perf.now === 'function' ? () => perf.now() : () => Date.now()

async function measure(
  url: string,
  timeoutMs: number,
  fetchFn: typeof fetch
): Promise<number | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = now()
  try {
    // The race is a wall-clock backstop: if an implementation ignores the
    // abort signal, the worker slot is still released at the deadline
    // (slightly after, to let a well-behaved abort win the race).
    const timedOut = await Promise.race([
      fetchFn(url, { method: 'HEAD', signal: controller.signal }).then(
        () => false
      ),
      new Promise<true>((resolve) =>
        setTimeout(() => resolve(true), timeoutMs + 250)
      ),
    ])
    if (timedOut) return null
    return Math.max(0, Math.round(now() - startedAt))
  } catch {
    if (controller.signal.aborted) return null // timed out — unreachable
    const elapsed = now() - startedAt
    // Settled with a protocol/TLS error before the deadline: the host
    // answered at TCP level — that's a valid reachability latency.
    return elapsed < timeoutMs ? Math.max(0, Math.round(elapsed)) : null
  } finally {
    clearTimeout(timer)
  }
}
