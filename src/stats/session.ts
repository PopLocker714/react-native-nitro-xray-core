import type { TrafficStats } from '../specs/nitro-xray-core.nitro'

/**
 * Session-continuous traffic accounting on top of per-engine-instance counters.
 *
 * Xray-core stats counters live inside a single `core.Instance`. Switching
 * servers restarts the engine, so the raw counters reset to zero even though
 * the VPN session (from the user's point of view) continues. This class folds
 * each engine generation's final counters into a baseline whenever a reset is
 * detected (raw value went backwards), so totals only ever grow within a
 * session.
 *
 * During the restart gap the native side reports zeros; those fold the
 * previous generation into the baseline and the returned total holds steady —
 * no transient 0-flash reaches the UI.
 *
 * Pure logic, no native imports — unit-testable.
 */
export class TrafficSession {
  private baselineUp = 0
  private baselineDown = 0
  private lastRawUp = 0
  private lastRawDown = 0
  private suspended = false

  /** Feed the latest raw counters; returns session-cumulative totals. */
  update(raw: TrafficStats): TrafficStats {
    if (this.suspended) {
      // Restart in progress: samples are ambiguous (old engine, gap zeros, or
      // new engine) — hold the last known totals and mutate nothing.
      return {
        uplink: this.baselineUp + this.lastRawUp,
        downlink: this.baselineDown + this.lastRawDown,
      }
    }
    if (raw.uplink < this.lastRawUp || raw.downlink < this.lastRawDown) {
      // Engine restarted: previous generation's counters are gone — bank them.
      // Fallback path for platforms where state events don't reach suspend().
      this.baselineUp += this.lastRawUp
      this.baselineDown += this.lastRawDown
    }
    this.lastRawUp = raw.uplink
    this.lastRawDown = raw.downlink
    return {
      uplink: this.baselineUp + raw.uplink,
      downlink: this.baselineDown + raw.downlink,
    }
  }

  /**
   * An engine restart began ('connecting'): freeze totals and ignore samples
   * until {@link commitRestart}. Prevents a stale old-engine sample from
   * corrupting the baseline mid-switch.
   */
  suspend(): void {
    this.suspended = true
  }

  /**
   * The restart finished ('connected' / terminal state): bank the previous
   * generation unconditionally and resume counting from the new engine.
   * Unlike the raw<last heuristic in update(), this also covers the case
   * where the new counter climbed past the old one before the next sample
   * (e.g. app was backgrounded across the switch).
   */
  commitRestart(): void {
    this.baselineUp += this.lastRawUp
    this.baselineDown += this.lastRawDown
    this.lastRawUp = 0
    this.lastRawDown = 0
    this.suspended = false
  }

  /** Start a fresh session: totals return to zero. */
  reset(): void {
    this.baselineUp = 0
    this.baselineDown = 0
    this.lastRawUp = 0
    this.lastRawDown = 0
    this.suspended = false
  }
}
