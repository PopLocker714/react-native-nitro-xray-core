const codes = ['attempt_started', 'stopped', 'cancelled', 'engine_started', 'parse_failed',
  'init_failed', 'start_failed', 'stop_failed', 'already_running', 'proxy_ready',
  'proxy_timeout', 'logger_started', 'logger_closing', 'no_config', 'system_replay_denied',
  'proxy_retry_failed', 'proxy_retry_timeout', 'fatal', 'link_connected', 'reconnect', 'session_accepted'] as const
export interface DiagnosticEvent {
  seq: number; utc: string; elapsedMs: number; clockScope: string; attempt: number
  source: 'app' | 'xray' | 'olcrtc'; producer: 'android_service' | 'ios_app' | 'ios_ne' | 'go'
  phase: 'lifecycle'; code: typeof codes[number]; severity: 'info' | 'warning' | 'error' | 'fatal'
}
export type DiagnosticSnapshot = { available: false } | {
  available: true; events: DiagnosticEvent[]; next: number; more: boolean
  dropped: number; truncated: number; probe: 'unavailable'
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => key in value)
}
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 }
function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.some(item => item === value)
}
function event(value: unknown): value is DiagnosticEvent {
  return object(value) && exact(value, ['seq','utc','elapsedMs','clockScope','attempt','source','producer','phase','code','severity']) &&
    integer(value.seq) && integer(value.elapsedMs) && integer(value.attempt) &&
    typeof value.utc === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(value.utc) &&
    typeof value.clockScope === 'string' && /^go-\d{1,20}$/.test(value.clockScope) &&
    oneOf(value.source, ['app','xray','olcrtc']) && oneOf(value.producer, ['android_service','ios_app','ios_ne','go']) &&
    value.phase === 'lifecycle' && oneOf(value.code, codes) && oneOf(value.severity, ['info','warning','error','fatal']) &&
    JSON.stringify(value).length <= 512
}
/** Reject, rather than forward, unknown keys and arbitrary text. */
export function parseDiagnosticSnapshot(raw: string): DiagnosticSnapshot {
  if (typeof raw !== 'string' || raw.length > 32768 || /[^\x00-\x7f]/.test(raw)) return { available: false }
  try {
    const value: unknown = JSON.parse(raw)
    if (!object(value) || value.available !== true ||
      !exact(value, ['available','events','next','more','dropped','truncated','probe']) ||
      !Array.isArray(value.events) || value.events.length > 1024 || !value.events.every(event) ||
      !integer(value.next) || !integer(value.dropped) || !integer(value.truncated) ||
      typeof value.more !== 'boolean' || value.probe !== 'unavailable') return { available: false }
    let previous = -1
    for (const item of value.events) { if (item.seq <= previous || item.seq > value.next) return { available: false }; previous = item.seq }
    return { available: true, events: value.events, next: value.next, more: value.more,
      dropped: value.dropped, truncated: value.truncated, probe: 'unavailable' }
  } catch { return { available: false } }
}
