import { describe, expect, test } from 'bun:test'
import { parseDiagnosticSnapshot } from '../diagnosticsWire'
const entry = { seq: 1, utc: '2026-11-09T12:00:00Z', elapsedMs: 4, clockScope: 'go-123',
 attempt: 1, source: 'xray', producer: 'go', phase: 'lifecycle', code: 'engine_started', severity: 'info' }
const page = { available: true, events: [entry], next: 1, more: false, dropped: 0, truncated: 0, probe: 'unavailable' }
const parse = (value: unknown) => parseDiagnosticSnapshot(JSON.stringify(value))
describe('diagnostic privacy boundary', () => {
 test('accepts bounded native facts', () => expect(parse(page)).toEqual(page))
 test('old binary/unavailable/malformed is unavailable', () => {
  for (const raw of ['{}','{"available":false}', 'invalid', 'null', '[]']) expect(parseDiagnosticSnapshot(raw)).toEqual({ available: false })
 })
 test('rejects unknown fields at every boundary', () => {
  expect(parse({ ...page, config: 'secret' })).toEqual({ available: false })
  expect(parse({ ...page, events: [{ ...entry, url: 'https://private.example/key' }] })).toEqual({ available: false })
 })
 test('rejects arbitrary strings in each enumerated field', () => {
  for (const key of ['code','phase','source','producer','severity','clockScope','utc'])
   for (const value of ['https://private.example/key','eyJsecret.token.signature','a@private.example','192.0.2.1'])
    expect(parse({ ...page, events: [{ ...entry, [key]: value }] })).toEqual({ available: false })
 })
 test('rejects page bytes above hard cap', () => expect(parseDiagnosticSnapshot(' '.repeat(32769))).toEqual({ available: false }))
 test('rejects count overflow and unordered/duplicate cursors', () => {
  expect(parse({ ...page, events: Array(1025).fill(entry) })).toEqual({ available: false })
  expect(parse({ ...page, events: [entry, entry] })).toEqual({ available: false })
  expect(parse({ ...page, next: 0 })).toEqual({ available: false })
 })
 test('rejects invalid numeric fields', () => {
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
   for (const key of ['next','dropped','truncated']) expect(parse({ ...page, [key]: value })).toEqual({ available: false })
   for (const key of ['seq','attempt','elapsedMs']) expect(parse({ ...page, events: [{ ...entry, [key]: value }] })).toEqual({ available: false })
  }
 })
 test('probe cannot claim tun_path or engine_chain capability', () => {
  for (const probe of ['tun_path','engine_chain','available']) expect(parse({ ...page, probe })).toEqual({ available: false })
 })
})
