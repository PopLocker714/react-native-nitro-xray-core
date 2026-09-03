// Native engine + state multiplexer
export { NitroXrayCore, addStateListener } from './native'
export type { StateListener } from './native'

// High-level client (recommended entry point)
export { XrayClient } from './client'
export type { ConnectOptions, SubscriptionResult, ConnectionInfo } from './client'
export { XrayError, toXrayError } from './errors'
export type { XrayErrorCode } from './errors'

// Subscription parsing
export {
  parseShareLink,
  parseSubscription,
  parseSubscriptionUserInfo,
} from './subscription/parse'
export type {
  ParsedServer,
  ProxyProtocol,
  Network,
  Security,
  SubscriptionInfo,
} from './subscription/types'

// Native core versions (Xray-core + olcrtc), generated from the shipped binaries
export { CORE_VERSIONS } from './generated/core-versions'
export type { CoreVersions } from './generated/core-versions'

// Session-continuous traffic accounting (pure logic)
export { TrafficSession } from './stats/session'

// URLTest — latency probing / server sorting (pure TS)
export { urlTest } from './urltest/urltest'
export type { UrlTestOptions, UrlTestResult } from './urltest/urltest'

// Config building
export { buildXrayConfig, buildOlcrtcTunnelConfig } from './config/build'
export type {
  BuildConfigOptions,
  OlcrtcChainOptions,
  OlcrtcTunnelOptions,
} from './config/build'

// olcrtc client (WebRTC side-channel "Russia bypass")
export type { OlcrtcClientConfig } from './olcrtc/types'

// Shared types from the native spec
export type {
  TrafficStats,
  XrayState,
  NotificationConfig,
} from './specs/nitro-xray-core.nitro'
