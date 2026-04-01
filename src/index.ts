import { NitroModules } from 'react-native-nitro-modules'
import type { NitroXrayCore as NitroXrayCoreSpec } from './specs/nitro-xray-core.nitro'

export const NitroXrayCore =
  NitroModules.createHybridObject<NitroXrayCoreSpec>('NitroXrayCore')