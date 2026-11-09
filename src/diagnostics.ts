import { NitroXrayCore } from './native'
import { parseDiagnosticSnapshot, type DiagnosticSnapshot } from './diagnosticsWire'
export type { DiagnosticSnapshot, DiagnosticEvent } from './diagnosticsWire'

/** Old native binaries and unreachable extensions are explicitly unavailable. */
export async function getDiagnosticSnapshot(after = 0): Promise<DiagnosticSnapshot> {
  if (!Number.isSafeInteger(after) || after < 0) throw new RangeError('Invalid diagnostic cursor')
  try {
    if (typeof NitroXrayCore.getDiagnosticSnapshot !== 'function') return { available: false }
    return parseDiagnosticSnapshot(await NitroXrayCore.getDiagnosticSnapshot(after))
  } catch { return { available: false } }
}
export async function clearDiagnostics(): Promise<{ available: boolean }> {
  try {
    if (!(await getDiagnosticSnapshot()).available) return { available: false }
    await NitroXrayCore.clearDiagnostics()
    return { available: true }
  } catch { return { available: false } }
}
export function getSystemVpnStatus(): SystemVpnStatus {
  try {
    const value: unknown = JSON.parse(NitroXrayCore.getSystemVpnStatus())
    if (value && typeof value === 'object' && 'supported' in value &&
      typeof value.supported === 'boolean' && 'alwaysOn' in value &&
      (value.alwaysOn === null || typeof value.alwaysOn === 'boolean') &&
      'lockdown' in value && (value.lockdown === null || typeof value.lockdown === 'boolean')) {
      return { available: true, supported: value.supported, alwaysOn: value.alwaysOn,
        lockdown: value.lockdown, settingsAction: 'android.settings.VPN_SETTINGS' }
    }
  } catch { /* Missing native capability. */ }
  return { available: false }
}
export type SystemVpnStatus = { available: false } | {
  available: true; supported: boolean; alwaysOn: boolean | null; lockdown: boolean | null
  settingsAction: 'android.settings.VPN_SETTINGS'
}
