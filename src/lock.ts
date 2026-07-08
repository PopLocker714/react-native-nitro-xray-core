/**
 * A serial async lock: each operation runs strictly after the previous one has
 * settled (success OR failure), so overlapping engine-mutating calls (a
 * double-tapped Connect, connect-then-disconnect) can't interleave. A rejected
 * op does not break the chain — the next op still runs.
 */
export function createSerialLock(): <T>(op: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve()
  return function withLock<T>(op: () => Promise<T>): Promise<T> {
    const run = chain.then(op, op)
    // Keep the chain alive but swallow the result so one failure/return value
    // doesn't leak into the next op or break the sequence.
    chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
}
