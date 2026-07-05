import { NitroModules } from 'react-native-nitro-modules'
import type {
  NitroXrayCore as NitroXrayCoreSpec,
  XrayState,
} from './specs/nitro-xray-core.nitro'

/**
 * Low-level Nitro hybrid object. Prefer the higher-level `XrayClient` and
 * `addStateListener` over calling `onStateChange` directly — the native side
 * only holds a single state callback slot.
 */
export const NitroXrayCore =
  NitroModules.createHybridObject<NitroXrayCoreSpec>('NitroXrayCore')

/** Callback invoked whenever the native engine changes connection state. */
export type StateListener = (state: XrayState, message: string) => void

const stateListeners = new Set<StateListener>()
let nativeListenerRegistered = false

function ensureNativeListener(): void {
  if (nativeListenerRegistered) return
  NitroXrayCore.onStateChange((state: string, message: string) => {
    const typed = state as XrayState
    for (const listener of stateListeners) {
      listener(typed, message)
    }
  })
  nativeListenerRegistered = true
}

/**
 * Subscribe to engine state changes. Returns an unsubscribe function.
 * Multiple subscribers are multiplexed over the single native callback.
 */
export function addStateListener(listener: StateListener): () => void {
  ensureNativeListener()
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}
