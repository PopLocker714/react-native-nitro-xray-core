import { expect, mock, test } from 'bun:test'
const native: Record<string, unknown> = {}
mock.module('react-native-nitro-modules', () => ({ NitroModules: { createHybridObject: () => native } }))
const api = await import('../diagnostics')
test('old hybrid binary is unavailable and clear cannot claim success', async () => {
 expect(await api.getDiagnosticSnapshot()).toEqual({ available: false })
 expect(await api.clearDiagnostics()).toEqual({ available: false })
 expect(api.getSystemVpnStatus()).toEqual({ available: false })
})
test('native throws or returns arbitrary payload: no raw content escapes', async () => {
 native.getDiagnosticSnapshot = () => Promise.resolve('{"available":true,"secret":"https://private.example"}')
 expect(await api.getDiagnosticSnapshot()).toEqual({ available: false })
 native.getDiagnosticSnapshot = () => { throw new Error('secret') }
 expect(await api.getDiagnosticSnapshot()).toEqual({ available: false })
})
test('cursor validation rejects before native invocation', async () => {
 for (const value of [-1, 0.5, NaN, Infinity]) await expect(api.getDiagnosticSnapshot(value)).rejects.toThrow(RangeError)
})
