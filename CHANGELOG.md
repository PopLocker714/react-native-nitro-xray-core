## [1.1.0](https://github.com/PopLocker714/react-native-nitro-xray-core/compare/v1.0.2...v1.1.0) (2026-07-06)

### ✨ Features

* **deploy:** prebuilt olcrtc image (July canon) + pull-only compose for Dokploy ([b5d6f7f](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/b5d6f7f9efd2e1a30d18df11b0047b8b9e67404a))
* **example:** copyable/shareable logs + surface uncaught errors ([31fe9ba](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/31fe9ba8bb3f16a575ea79750df48c1b8816a18c))
* **example:** in-app vp8 fps presets (30/60/90) + live down-speed readout ([3a0f0f1](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/3a0f0f13f9ac466a0f7b734ddaefcda9f35b81cd))
* **example:** olcrtc bypass toggle wired with working wbstream config ([2314063](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/23140638a7d08afad3ab5ed9a0bfd793179f7bde))
* **example:** switch olcrtc to jitsi+datachannel (meet1.arbitr.ru) for speed ([e411864](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/e41186420e05271694078a5a0d7df7d8da1e477a))
* **ios:** Phase 1 — getStats over NE bridge + real kill switch + state events ([4727e64](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/4727e643c0125a65a3b0be42ca9b578c51a85b50))
* **ios:** Phase 2 — Keychain config store + shared access group; Release install ([55aecd3](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/55aecd3d706163163af7ef68e41b2eea77177289))
* **ios:** Phase 2a — configurable DNS in NE + robust TUN fd lookup ([8b06444](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/8b064448d7e68c73dedf80e005d15ae29c613a85))
* **ios:** Phase 3 experiment — merged olcrtc core builds + memory measured ([1c92a17](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/1c92a17b5ed22d09844f1762adf4b7c7dbfa5085))
* **ios:** real olcrtc — NE starts olcrtc before xray (config-embedded) ([fe66ecb](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/fe66ecb35389be29048f08ecbe52014ec1a0a3cc))
* **ios:** restore spec conformance — getVersion/getStats/onStateChange (Phase 0) ([fc68152](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/fc68152fe13ead1c3257e695a2131f27b9c186d7))
* **notification:** configurable foreground notification + Disconnect button ([e02da17](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/e02da173bac81fdd950caec9bbac92398b690710))
* **olcrtc:** auto-retry the flaky WebRTC handshake (both platforms) ([b9f67a9](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/b9f67a9ba33ef1941f34660ba5e33c5fac897b37))
* **olcrtc:** merged Go core + startOlcrtc through all layers + xray dialerProxy chaining ([5279fdd](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/5279fdd178592e0b8d08f6a488c202bd7a1f814f))
* **olcrtc:** olcrtc-only tunnel mode (TUN -> olcrtc, no VLESS server) ([ec4a514](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/ec4a5146edb14e692bbc0da4a5f117753d828ba7))
* **olcrtc:** vp8channel throughput tuning + revert client to wbstream ([debebf9](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/debebf96e3dcf9cfe418ce4900e5e997e07a80f9))
* **perms:** XrayClient.requestNotificationPermission() + request on example startup ([6276f00](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/6276f006db96bca895390b6819e09bb42aafa2de))

### 🐛 Bug Fixes

* **deploy:** build olcrtc from remote git context, not local clone ([9765eef](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/9765eef12752afb8532641b7733a34d9d8b058e6))
* **deploy:** default to wbstream+vp8channel (jitsi is token-gated, unusable) ([b152316](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/b152316532e5239ad536058d7b223acf49fb2c2a))
* **deploy:** point olcrtc build at the fork that actually has the Dockerfile ([2d1ab8c](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/2d1ab8cdc68238f5288766d726f1661082028d69))
* **example:** request VPN permission when enabling olcrtc (iOS re-creates config) ([b75fd71](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/b75fd71bd51078e4be7e14c9f9cb164e0ce28758))
* **ios:** olcrtc reliability — background start, armed isOlcrtcRunning, FreeOSMemory ([571ef32](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/571ef32ee82f4dba34b6402350ae38d4dc9cadb7))
* **olcrtc:** stop stale instance before start + route internals to logcat ([886d83b](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/886d83bc4c3f1d8fb4a4e594d3e478bf172fc49d))
* **scripts:** de-unicode install-device.sh (ellipsis broke $DEVICE under set -u) ([deb93c6](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/deb93c6ba2d4f9e60a227093cefc7905653a4616))
* **vpn:** remove foreground notification on stop so the tray lock clears ([279c081](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/279c08145f5f57abe83c793c51134d9088ac2ff0))

### 📚 Documentation

* **deploy:** multi-arch build (amd64+arm64) + meet.jit.si token gotcha ([06ffeb3](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/06ffeb35695981e62dd061f0dc36c8efcc0edeb0))
* **deploy:** wbstream room.id is the bare UUID, not the full URL ([9a601be](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/9a601be54820ce67eff58a0bb2e91b53df145d2d))
* **ios:** add docs/IOS.md (architecture, olcrtc, build/sign, gotchas) ([21a15da](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/21a15da44faf4cf6acfb09312ce12c9aad6723b1))
* **isa:** iOS olcrtc memory not cheaply reducible (~57MB, FreeOSMemory 0 gain) ([d8aa357](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/d8aa357c0744dde96d3c14fed9650e2d83f03c88))
* **isa:** iOS Phase 0-1 device-verified (connect/stats/kill-switch/state) ([811c9a8](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/811c9a8d9aeea05ae11e8d149edf1ebd62bc641c))
* **isa:** iOS Phase 2 hardening device-verified (Keychain/DNS/fd) ([eb83646](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/eb836462420e40eb01d899ca2ea167d214f1e0c1))
* **isa:** iOS Phase 3 olcrtc feasibility measured — works, ~57MB (tight) ([414c253](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/414c253e1269715a7ba8d509b3b0a5a6a53984a9))
* **isa:** olcrtc auto-retry + iOS VPN-permission-on-enable device-verified ([58fd48a](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/58fd48a4808b8fbfefd8cb101a128816fbd04731))
* **isa:** olcrtc-iOS wired + device-verified; first-attempt retry open (ISC-116) ([9f52552](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/9f52552562ef8fe6eb7c1a08306c7457601e1c63))
* **isa:** stage 4 olcrtc — prebuilt image pushed, deploy verified (96/100) ([766cb99](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/766cb992a3421af3d2a410970dcb75cd4bfc0591))

### 🛠️ Other changes

* **deploy:** compose pulls jojo714/olcrtc:latest by default; jitsi+datachannel defaults ([8fcd8a4](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/8fcd8a4229c60e820980ba49ada2635491965385))
* **example:** update olcrtc room to 019f32ee-… ([0ae1111](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/0ae11111cc388ca47abc991f808af9d6a17d2ec6))
* **ios:** commit slim xcframework (arm64 device + arm64 sim, ~63MB each) ([b2f185a](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/b2f185a954160540a465fc5325bcebd6ffe046ba))
* **ios:** pod install refresh (NitroXrayCore 0.1.0 -> 1.0.2, pbxproj normalize) ([2a2c0af](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/2a2c0af026ae94b2d38ce3eb43c98ff0272b8c22))
* **scripts:** install-device.sh — standalone release APK to a real phone ([e574b4c](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/e574b4cde82a2cf65656f6ddcde3a5dff79f4ec9))

## [1.0.2](https://github.com/PopLocker714/react-native-nitro-xray-core/compare/v1.0.1...v1.0.2) (2026-04-07)

### 🐛 Bug Fixes

* remove static identifaers ([82ae216](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/82ae21663d0d79a2a782217c6bd11c4bdec1a612))

### 🔄 Code Refactors

* format ([d37a2bd](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/d37a2bd2382313dc144603e4b6ab3fcc5db1eafd))

## [1.0.1](https://github.com/PopLocker714/react-native-nitro-xray-core/compare/v1.0.0...v1.0.1) (2026-04-05)

### 🛠️ Other changes

* delene plan ([d364e82](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/d364e8202fb0c9683ee7b299c8046a2ee799aedc))

## 1.0.0 (2026-04-05)

### 🛠️ Other changes

* configuration refactor, iOS build docs, and Android namespace fix ([f6120f1](https://github.com/PopLocker714/react-native-nitro-xray-core/commit/f6120f1333e4c8b5650a65b75016b9d1746acc4a))
