import { describe, expect, test } from 'bun:test'
import { TrafficSession } from '../session'

describe('TrafficSession', () => {
  test('passes monotonic growth through unchanged', () => {
    const s = new TrafficSession()
    expect(s.update({ uplink: 5, downlink: 50 })).toEqual({
      uplink: 5,
      downlink: 50,
    })
    expect(s.update({ uplink: 10, downlink: 100 })).toEqual({
      uplink: 10,
      downlink: 100,
    })
  })

  test('folds previous generation into baseline on counter reset', () => {
    const s = new TrafficSession()
    s.update({ uplink: 5_000_000, downlink: 50_000_000 })
    // Engine restarted (server switch): raw counters restart near zero.
    const total = s.update({ uplink: 200_000, downlink: 1_000_000 })
    expect(total).toEqual({ uplink: 5_200_000, downlink: 51_000_000 })
  })

  test('holds the baseline through the transient-zeros restart gap', () => {
    const s = new TrafficSession()
    s.update({ uplink: 5, downlink: 50 })
    // During restart the native side reports zeros — no 0-flash to the UI.
    expect(s.update({ uplink: 0, downlink: 0 })).toEqual({
      uplink: 5,
      downlink: 50,
    })
    // New engine generation starts counting again.
    expect(s.update({ uplink: 3, downlink: 30 })).toEqual({
      uplink: 8,
      downlink: 80,
    })
  })

  test('accumulates across multiple resets in one session', () => {
    const s = new TrafficSession()
    s.update({ uplink: 10, downlink: 100 })
    s.update({ uplink: 2, downlink: 20 }) // reset #1
    s.update({ uplink: 5, downlink: 50 })
    const total = s.update({ uplink: 1, downlink: 10 }) // reset #2
    expect(total).toEqual({ uplink: 16, downlink: 160 })
  })

  test('detects reset when only one direction goes backwards', () => {
    const s = new TrafficSession()
    s.update({ uplink: 10, downlink: 100 })
    // Downlink went backwards, uplink coincidentally not — still a restart.
    const total = s.update({ uplink: 12, downlink: 5 })
    expect(total).toEqual({ uplink: 22, downlink: 105 })
  })

  test('suspend() holds totals and ignores ambiguous samples', () => {
    const s = new TrafficSession()
    s.update({ uplink: 5, downlink: 50 })
    s.suspend()
    // Stale old-engine sample mid-switch must not move anything.
    expect(s.update({ uplink: 6, downlink: 60 })).toEqual({
      uplink: 5,
      downlink: 50,
    })
    s.commitRestart()
    expect(s.update({ uplink: 2, downlink: 20 })).toEqual({
      uplink: 7,
      downlink: 70,
    })
  })

  test('commitRestart() banks previous generation even when the new counter overtakes the old', () => {
    const s = new TrafficSession()
    s.update({ uplink: 5, downlink: 50 })
    s.suspend()
    s.commitRestart()
    // App was backgrounded across the switch: first post-restart sample is
    // already ABOVE the pre-switch value — raw<last would have missed this.
    expect(s.update({ uplink: 7, downlink: 70 })).toEqual({
      uplink: 12,
      downlink: 120,
    })
  })

  test('commitRestart() on a fresh session is a no-op', () => {
    const s = new TrafficSession()
    s.commitRestart()
    expect(s.update({ uplink: 3, downlink: 30 })).toEqual({
      uplink: 3,
      downlink: 30,
    })
  })

  test('reset() zeroes the session', () => {
    const s = new TrafficSession()
    s.update({ uplink: 10, downlink: 100 })
    s.update({ uplink: 1, downlink: 1 }) // bank a baseline
    s.reset()
    expect(s.update({ uplink: 7, downlink: 70 })).toEqual({
      uplink: 7,
      downlink: 70,
    })
  })
})
