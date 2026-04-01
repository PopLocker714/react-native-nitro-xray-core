import type { HybridObject } from 'react-native-nitro-modules'

export interface NitroXrayCore extends HybridObject<{ ios: 'swift', android: 'kotlin' }> {
  hasVpnPermission(): Promise<boolean>
  requestVpnPermission(): Promise<void>
  requestNotificationPermission(): Promise<boolean>
  startXray(configJson: string): Promise<void>
  stopXray(): Promise<void>
}