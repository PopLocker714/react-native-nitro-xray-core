import type { HybridObject } from 'react-native-nitro-modules'

export interface NitroXrayCore extends HybridObject<{ ios: 'swift', android: 'kotlin' }> {
  prepareVpn(): Promise<void>
  startXray(configJson: string): Promise<void>
  stopXray(): Promise<void>
}