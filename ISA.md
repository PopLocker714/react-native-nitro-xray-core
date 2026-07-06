---
project: react-native-nitro-xray-core
task: "Stage 4: olcrtc — chaining + merged core + JNI/spec (startOlcrtc)"
slug: stage4-olcrtc-chaining
effort: E3
phase: complete
progress: 96/100
mode: standard
started: 2026-07-05T12:00:00+03:00
updated: 2026-07-05T15:40:00+03:00
---

# ISA — react-native-nitro-xray-core

## Problem

1. Subscription servers return quota and expiry in the `subscription-userinfo` HTTP response header (`upload=…; download=…; total=…; expire=…`), but `XrayClient.fromSubscription` discards response headers — the app has no way to show quota or expiry in the UI.
2. When the user switches servers while connected, `XrayVpnService` tears down the Go `core.Instance` and starts a new one. Xray stats counters are per-instance, so the UI traffic counter drops to 0 even though traffic keeps flowing. After re-opening the app it "looks normal" only because the new instance has accumulated bytes by then.

## Vision

The example app shows the subscription plan at a glance — used/total quota and expiry date — right after loading the subscription. Switching servers never visually resets the session traffic counter: it keeps counting up seamlessly across engine restarts, on both platforms, without a native rebuild.

## Out of Scope

- Rebuilding libxray.so / Go-side counter persistence (JS-layer fix covers both platforms).
- iOS PacketTunnelProvider stats plumbing (separate work; iOS Swift hybrid currently lacks getStats).
- Persisting traffic totals across app restarts.
- Auto-refresh of subscription info on a timer.

## Constraints

- Public API stays backward compatible: `fromSubscription`, `stats()` signatures unchanged for existing callers.
- bun/TypeScript only; no new runtime dependencies.
- Library changes live in `src/`; UI changes in `example/App.tsx`.
- Pure logic must be unit-testable without the native module (extract, don't inline).

## Goal

`XrayClient.fromSubscriptionWithInfo()` returns servers plus parsed `SubscriptionInfo` (upload/download/total/expire) rendered in the example UI, and `XrayClient.stats()` returns session-continuous counters that survive server switches, verified by unit tests and typecheck.

## Criteria

### Feature: subscription-userinfo parsing
- [x] ISC-1: `SubscriptionInfo` interface exists in `src/subscription/types.ts` with optional `upload`, `download`, `total`, `expire` number fields
- [x] ISC-2: `parseSubscriptionUserInfo` exported from `src/subscription/parse.ts`
- [x] ISC-3: Parses canonical header `upload=455727941; download=6174315083; total=1073741824000; expire=1719990770` into all four fields
- [x] ISC-4: Returns null for null/empty/garbage input
- [x] ISC-5: Tolerates missing fields (e.g. no expire) — omits them, keeps the rest
- [x] ISC-6: Tolerates whitespace variations and case-insensitive keys
- [x] ISC-7: Ignores unknown keys without failing
- [x] ISC-8: Non-numeric values for a key are skipped, not NaN

### Feature: client API
- [x] ISC-9: `XrayClient.fromSubscriptionWithInfo(url, init?)` exists and returns `{ servers, info }`
- [x] ISC-10: `info` is `SubscriptionInfo | null` — null when header absent
- [x] ISC-11: `fromSubscription` keeps its exact current signature and behavior (returns `ParsedServer[]`)
- [x] ISC-12: Both fetch paths share one implementation (no duplicated fetch logic)
- [x] ISC-13: `SubscriptionInfo` and `parseSubscriptionUserInfo` exported from `src/index.ts`

### Feature: session-continuous stats
- [x] ISC-14: Pure `TrafficSession` logic lives in `src/stats/session.ts` (no native imports)
- [x] ISC-15: Monotonic growth passes through unchanged (5 → 10 returns 10)
- [x] ISC-16: Counter reset detected (raw < last raw) folds last raw into baseline (5MB then 0.2MB returns 5.2MB)
- [x] ISC-17: Transient zeros during engine restart return the held baseline, never a 0-flash
- [x] ISC-18: Multiple resets in one session accumulate correctly
- [x] ISC-19: Per-tag isolation — sessions for different outbound tags don't cross-contaminate
- [x] ISC-20: `reset()` clears baseline and last-raw state
- [x] ISC-21: `XrayClient.stats()` routes raw native counters through the session accumulator
- [x] ISC-22: `XrayClient.connect()` resets the session only when starting fresh (not connected); switch keeps accumulating
- [x] ISC-23: `XrayClient.disconnect()` resets the session
- [x] ISC-24: `XrayClient.statsRaw()` escape hatch returns untouched native counters

### Feature: example UI
- [x] ISC-25: Example app calls `fromSubscriptionWithInfo` and stores `info` in state
- [x] ISC-26: Quota line renders used/total (e.g. "6.2 GB / 1000 GB") when total present
- [x] ISC-27: Expiry line renders a human date and days-left when expire present
- [x] ISC-28: No quota/expiry UI rendered when info is null (no empty placeholders)
- [x] ISC-29: formatBytes handles GB range (currently caps at MB)

### Verification & anti-criteria
- [x] ISC-30: All unit tests pass via `bun test`
- [x] ISC-31: `bun run typecheck` passes with zero errors
- [x] ISC-32: Anti: no changes to `src/specs/nitro-xray-core.nitro.ts` (no nitrogen regen needed) [scoped to quota/stats task]
- [x] ISC-33: Anti: no changes to Go/Kotlin/Swift native sources for the stats fix
- [x] ISC-34: Anti: existing `parse.test.ts` suite still passes untouched

### Stage 3 — Kill-switch API & spec
- [x] ISC-35: `setKillSwitch(enabled: boolean): Promise<void>` added to nitro spec (platform-neutral)
- [x] ISC-36: `isKillSwitchEnabled(): boolean` added to nitro spec
- [x] ISC-37: Nitrogen codegen runs clean (`bun run codegen` exit 0)
- [x] ISC-38: Kotlin `HybridNitroXrayCore.setKillSwitch` persists the flag (survives service/process restart via SharedPreferences)
- [x] ISC-39: iOS Swift implements both methods as an explicit not-yet-supported stub (compilable, throws with clear message; isKillSwitchEnabled returns false)
- [x] ISC-40: `XrayClient.setKillSwitch/isKillSwitchEnabled` facade exported from index.ts

### Stage 3 — Kill-switch behavior (Android)
- [x] ISC-41: Engine start failure with kill-switch ON keeps the TUN established (blackhole) instead of tearing down — no leak
- [x] ISC-42: Engine start failure with kill-switch OFF preserves current behavior (service stops, tun closed)
- [x] ISC-43: Server switch establishes the NEW tun before closing the old fd (seamless handover per VpnService.establish() docs — no leak window), independent of kill-switch flag
- [x] ISC-44: Explicit ACTION_STOP always tears down tun and engine, kill-switch notwithstanding (user intent wins)
- [x] ISC-45: State event 'error' message distinguishes "kill switch holding traffic" from plain failure
- [x] ISC-46: Anti: `Builder.setBlocking(true)` NOT used as kill-switch (it sets fd I/O mode, not traffic blocking) — deviation from plan documented
- [x] ISC-47: Anti: no Go source changes; prebuilt libxray.so untouched

### Stage 3 — URLTest (pure TS)
- [x] ISC-48: `src/urltest/urltest.ts` exists with no native imports (unit-testable)
- [x] ISC-49: `urlTest(servers, options?)` returns `UrlTestResult[]` sorted by latency ascending, unreachable (null) last
- [x] ISC-50: Per-server timeout (default 3000ms) — a hung fetch resolves to null latency
- [x] ISC-51: Concurrency limited (default 8 simultaneous probes), all servers still measured
- [x] ISC-52: Probe URL overridable via options (default `http://{address}:{port}`)
- [x] ISC-53: A fetch that settles (response OR fast network error) yields elapsed ms; only timeout/abort yields null — semantics documented as reachability-grade, not proxy throughput
- [x] ISC-54: Original server order preserved inside equal-latency groups (stable sort)
- [x] ISC-55: `XrayClient.urlTest` facade + `UrlTestResult` type exported from index.ts
- [x] ISC-56: Unit tests cover: sorting, timeout→null, concurrency cap, empty list

### Stage 3 — Docs & gates
- [x] ISC-57: `docs/STAGE3_ANDROID.md` written: kill-switch semantics, Always-on/Lockdown user instructions, URLTest usage, device checklist
- [x] ISC-58: IMPLEMENTATION_PLAN.md Stage 3 status updated (incl. setBlocking deviation note)
- [x] ISC-59: `bun test` all green (existing 34 + new urltest tests)
- [x] ISC-60: Lib + example typecheck clean
- [x] ISC-61: Example app: kill-switch toggle + "Ping all" button sorting the server list
- [x] ISC-62: Anti: existing stats/quota features from previous task unaffected (their tests still pass)

### Stage 4 — olcrtc integration (gate + config-layer chaining)
- [x] ISC-63: Gate 4.0 — olcrtc license verified permissive for a paid product (WTFPL, SPDX-confirmed via GitHub API `/license`)
- [x] ISC-64: Gate 4.0 — olcbox license verified permissive (MIT, SPDX-confirmed via GitHub API)
- [x] ISC-65: `OlcrtcChainOptions` interface (`socksPort`, optional `socksHost`, `tag`) exported from `src/config/build.ts` and `src/index.ts`
- [x] ISC-66: `buildXrayConfig` with no `olcrtc` option emits NO `sockopt` on the proxy outbound and NO extra socks outbound (backward compatible)
- [x] ISC-67: With `olcrtc` present, proxy outbound gets `streamSettings.sockopt.dialerProxy = "<tag>"` (default `olcrtc-out`)
- [x] ISC-68: With `olcrtc` present, a `socks` outbound is appended targeting `socksHost:socksPort` (default host `127.0.0.1`)
- [x] ISC-69: dialerProxy tag always references an outbound that exists (no dangling ref) — Forge-confirmed against xray-core `SocketConfig.dialerProxy` semantics; test asserts referenced tag resolves
- [x] ISC-70: Anti: proxy outbound keeps its own TLS/reality/transport settings (TLS terminates at the real server, not at the olcrtc hop) — Forge-confirmed: dialerProxy replaces only connection-establishment; reality/TLS runs on top of the socks-provided stream
- [x] ISC-71: `ConnectOptions extends BuildConfigOptions` so `connect(server, { olcrtc })` and `buildConfig` chain without a client-side change
- [x] ISC-72: `bun test` green incl. 6 new config chaining tests (46 pass, 0 fail)
- [x] ISC-73: `bun run typecheck` clean
- [ ] ISC-74: [DEFERRED-VERIFY] On-device: xray→olcrtc→server carries traffic on an RF mobile network — device-gated, Илья verifies (follow-up: Stage 4.1/4.2 native merge)

### Stage 4.2 — merged Go core (Android, StartOlcrtc wrapper)
- [x] ISC-75: olcrtc added to `go-core/go.mod` as one module importing both xray-core and olcrtc (pseudo-version, `go mod tidy` clean, no quic-go fork conflict — olcrtc is on pion/webrtc)
- [x] ISC-76: `go-core/libxray/olcrtc.go` exports `StartOlcrtc(configJson)` / `StopOlcrtc` / `GetOlcrtcSocksPort` / `IsOlcrtcRunning` (cgo, android-tagged, SOCKS-only, no TUN)
- [x] ISC-77: `StartOlcrtc` parses a JSON config → `mobile.Start` + `mobile.WaitReady`; records the SOCKS port for `GetOlcrtcSocksPort`; return codes 0/-1/-2/-3
- [x] ISC-78: Merged c-shared BUILDS for android/arm64 — the "two Go runtimes can't link" risk is empirically cleared: one module → one c-archive → one runtime. Artifact: 48.5 MB `libxray.so` + header
- [x] ISC-79: All four olcrtc symbols present in the built `.so` (`nm -D`) alongside existing `StartXray/StopXray/QueryStats`
- [x] ISC-80: `build_android.sh` carries `-checklinkname=0` (required: `wlynxg/anet` → `net.zoneCache` linkname, rejected by Go 1.23+; anet v0.0.5 latest still needs it)
- [x] ISC-81: Both ABIs build via `build_android.sh` — arm64-v8a (48.5 MB) + armeabi-v7a (49.9 MB) `libxray.so`, each with all 4 olcrtc symbols (`nm -D`), headers regenerated with the decls. On-device StartOlcrtc bring-up still device-gated (ISC-94).
- [ ] ISC-82: [DEFERRED] Android VpnService socket protection wired for olcrtc's own WebRTC sockets via `mobile.SetProtector` (else they loop back into the tun) — follow-up before real traffic
- [ ] ISC-83: [DEFERRED] iOS merged core (olcrtc) — needs an `olcrtc_ios.go` equivalent + the 48 MB lib vs NE ~15 MB memory limit is a hard open question (iOS Phase 3)

### iOS Phase 0-1 — device-verified 2026-07-06
- [x] ISC-101: iOS Swift restored to spec conformance — `getVersion`/`getStats`/`onStateChange` implemented; example builds green (simulator, app + NE)
- [x] ISC-102: `onStateChange` bridges `NEVPNStatusDidChange` → JS callback (loads manager so status is right after app restart; emits once + streams)
- [x] ISC-103: `main_ios.go` exports `QueryStats` (mirrors Android); `Xray.xcframework` rebuilt with it in both slices
- [x] ISC-104: `getStats()` app↔NE bridge via `sendProviderMessage`/`handleAppMessage` ({cmd:stats/version}) — real counters from the NE process
- [x] ISC-105: `setKillSwitch()` real impl — `NEOnDemandRule` + `includeAllNetworks` (fail-closed), persisted in UserDefaults, re-applied on every profile write; replaces the throw-stub
- [x] ISC-106: Signed device build (team 4548L5D8WL, automatic signing, App Group + Network Extension) installed on iPhone 11 and VERIFIED on-device: connect, live stats, kill switch, state events all work
### iOS Phase 2 — hardening (device-verified 2026-07-06)
- [x] ISC-107: Config secrets → Keychain (shared access group, encrypted, device-bound `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`) replacing the cleartext App Group plist; App Group kept as graceful fallback; team prefix resolved at runtime
- [x] ISC-108: NE DNS configurable — derived from the Xray config's `dns.servers` (valid IPs only), neutral fallback; replaces hardcoded 1.1.1.1/8.8.8.8
- [x] ISC-109: Robust `tunnelFileDescriptor` — returns the highest utun fd (our tunnel is newest) instead of first match; KVC fallback kept
- [x] ISC-110: `keychain-access-groups` entitlement added to app + NE; signed Release build (JS embedded, standalone) installed + verified on iPhone
### iOS Phase 3 — olcrtc feasibility (on-device measurement 2026-07-06)
- [x] ISC-111: `olcrtc_ios.go` written; merged xray+olcrtc+pion `Xray.xcframework` builds (`-checklinkname=0`), links, and LOADS on device
- [x] ISC-112: `StartOlcrtc` in the NE returns rc=0 — WebRTC runtime comes up inside the iOS packet-tunnel process
- [x] ISC-113: Measured RSS on iPhone 11 / iOS 18.4.1: xray baseline 40MB → olcrtc peak ~56.8MB, NO Jetsam kill. Old "15MB limit" was iOS 14-era; real limit ~50MB (iOS 15+). 48MB was disk size, not RSS.
- [ ] ISC-114: [OPEN] Peak ~57MB is over the ~50MB budget — survived but risky under memory pressure. Needs optimization before production: trim xray `distro/all` to used protocols (biggest lever — baseline is mostly mapped code), tune GOGC/SetMemoryLimit, leaner WebRTC. See [[olcrtc-ios-merged-core-open-question]]
- [ ] ISC-115: [DEFERRED] Full olcrtc-iOS wiring (Swift startOlcrtc real impl + dialerProxy chain) — gated on ISC-114 memory optimization

> **Build-only verification note:** the c-shared links and exports the symbols; StartOlcrtc has NOT been exercised on a device (needs real carrier/room/key). ISC-81 gates real traffic.

### Stage 4.3 — JNI bridge + Nitro spec (startOlcrtc through all layers)
- [x] ISC-84: Nitro spec adds `startOlcrtc(configJson): Promise<void>`, `stopOlcrtc(): Promise<void>`, `getOlcrtcSocksPort(): number`, `isOlcrtcRunning(): boolean` (platform-neutral)
- [x] ISC-85: `bun run codegen` clean (Generated 1/1); JNI descriptor still `Lcom/margelo/nitro/nitroxraycore/HybridNitroXrayCore;` (hotfix guard holds; post-script no-op fired)
- [x] ISC-86: `XrayEngine.kt` declares the 4 `external fun` mapping to the c-shared exports
- [x] ISC-87: `cpp-adapter.cpp` adds 4 JNI functions (`Java_com_nitroxraycore_XrayEngine_*Olcrtc*`) calling `StartOlcrtc`/`StopOlcrtc`/`GetOlcrtcSocksPort`/`IsOlcrtcRunning` — signatures match the generated `libxray.h`
- [x] ISC-88: Kotlin `HybridNitroXrayCore` implements all 4; `startOlcrtc` runs the blocking native call on `Dispatchers.IO` and maps return codes to thrown errors
- [x] ISC-89: iOS Swift `HybridNitroXrayCore` implements all 4 as compilable stubs (startOlcrtc rejects; getPort 0; isRunning false) — shared spec compiles
- [x] ISC-90: `XrayClient.startOlcrtc/stopOlcrtc/getOlcrtcSocksPort/isOlcrtcRunning` facade + `OlcrtcClientConfig` type exported from index.ts
- [x] ISC-91: lib typecheck exit 0, example typecheck exit 0, `bun test` 46 pass
- [x] ISC-92: Library Kotlin compiles via gradle `:react-native-nitro-xray-core:compileDebugKotlin` — BUILD SUCCESSFUL
- [x] ISC-93: Finding — `VpnService.protect` for olcrtc is NOT needed and would be dead code: `XrayVpnService.setupVpn` already calls `addDisallowedApplication(packageName)` (line ~200), excluding the WHOLE app process (xray + olcrtc) from the tun. That is the existing loop-prevention mechanism; per-socket protect is redundant.

### Stage 4.4 — full native build + deploy assets
- [x] ISC-95: `cpp-adapter.cpp` compiles against the regenerated `libxray.h` and links the 48 MB `.so` — gradle `buildCMakeDebug[arm64-v8a]` BUILD SUCCESSFUL. This is the gate before `bun run android`; it now passes.
- [x] ISC-96: olcrtc server `deploy/olcrtc/docker-compose.yml` + `.env.example` + `README.md` created; `docker compose config` validates. Transport defaulted to `vp8channel` to match the native client default (mismatch would break pairing).
- [x] ISC-97: No official olcrtc image exists (verified: Docker Hub 404, no public GHCR package, CI has no publish job) and canonical repo has no Dockerfile (removed upstream; only the 207-commits-behind alananisimov fork had one). Documented.
- [x] ISC-98: Self-contained `deploy/olcrtc/Dockerfile` builds CANONICAL olcrtc pinned to the client's commit `1255cf8` (Go 1.26 base — canonical requires go>=1.26.3), vendoring entrypoint/healthcheck (config schema identical to fork, field-verified). Version skew RESOLVED: server == client commit, no client rebuild needed.
- [x] ISC-99: Image built + smoke-tested locally (216 MB) — boots, generates key, authenticates with wbstream (guest token), reaches join-room (404 only for the fake test room = full pipeline OK).
- [x] ISC-100: Pushed to `jojo714/olcrtc:latest` + `:canon-1255cf8` (digest b8ab721d); independent `docker pull` after local delete succeeds → Dokploy can pull. Compose is pull-only so the deploy server never compiles.
- [ ] ISC-94: [DEFERRED-VERIFY] On-device: `bun run android` installs, StartOlcrtc pairs with the docker server and carries traffic on an RF network — Илья runs.

## Test Strategy

| isc | type | check | threshold | tool |
|-----|------|-------|-----------|------|
| 1-8 | unit | parseSubscriptionUserInfo cases | all pass | bun test |
| 9-13 | static | exports + signatures | typecheck clean | tsc / Grep |
| 14-20 | unit | TrafficSession cases | all pass | bun test |
| 21-24 | static | client.ts wiring | Read/Grep confirms | Read |
| 25-29 | static+live | App.tsx renders info | Read + emulator screenshot (deferred if app not installed) | Read / adb |
| 30-31 | gate | bun test && typecheck | exit 0 | Bash |
| 32-34 | anti | git diff scope | no forbidden paths | Bash git diff |

## Features

| name | satisfies | depends_on | parallelizable |
|------|-----------|------------|----------------|
| userinfo-parser | ISC-1..8 | — | yes |
| client-api | ISC-9..13 | userinfo-parser | no |
| traffic-session | ISC-14..20 | — | yes |
| client-stats-wiring | ISC-21..24 | traffic-session | no |
| example-ui | ISC-25..29 | client-api | no |
| verification | ISC-30..34 | all | no |

## Decisions

- 2026-07-05: Root cause of traffic-zeroing confirmed by code trace: `XrayVpnService.onStartCommand` → `stopVpn()` → new `core.Instance` in Go → per-instance stats counters reset. Fix at JS client layer (reset-detection accumulator) — covers Android AND iOS, no native rebuild, no 0-flash during the restart gap.
- 2026-07-05: Root-cause-at-ingestion check: ingestion point is engine restart in native code; fixing in Go would require rebuilding libxray.so for all ABIs and wouldn't cover iOS (engine in tunnel extension process). JS-layer session accumulator is the highest-leverage single fix.
- 2026-07-05: ISA written directly via Write tool per v6.2.x deferred note (ISA skill CLI not yet implemented).
- 2026-07-05: Delegation floor (E3 ≥2) relaxed to 1 (Forge) — show-your-math: exploration was 6 directed reads completed inline in <2min; a second Explore/Anvil agent would re-read the same 6 files with no new signal. Forge covers the review axis.
- 2026-07-05: refined: Advisor + Forge both flagged the same false-negative in raw<last reset detection (new counter overtakes old before next poll, common when app backgrounded across a switch). Hardened: state-event-driven `suspend()` on 'connecting' + unconditional `commitRestart()` on terminal states; raw<last kept as fallback where state events don't fire (current iOS Swift impl lacks onStateChange).
- 2026-07-05: refined: `total=0`/`expire=0` follow the ecosystem convention "unlimited/never" — parser keeps literal values (minus negatives), example UI renders ∞ / hides 1970.
- 2026-07-05: On-device verification explicitly deferred to Илья ("проверять не нужно я сам проверю").
- 2026-07-05 (stage 3): Plan deviation — `Builder.setBlocking(true)` rejected as kill-switch mechanism (FirstPrinciples: it sets fd I/O mode; xray forces non-blocking itself via unix.SetNonblock). Real mechanism: hold established TUN as blackhole on engine failure; seamless tun replacement on switch (establish new before closing old fd).
- 2026-07-05 (stage 3): Research agent confirmed via xray-core sources: tun inbound reads env `xray.tun.fd` per Handler.Start, does NOT dup and does NOT close the fd on instance Close — the app owns the fd; our closeQuietly is required and double-close-safe.
- 2026-07-05 (stage 3): Advisor + Forge convergent lifecycle findings hardened: engineLock serializes START/STOP/onRevoke worker threads; commandSeq supersedes stale queued starts; setPendingStart settles overwritten pending (no hung Promise); STOP resolves in-flight start; @Volatile vpnInterface; onDestroy emits disconnected from held-blackhole too; held-state notification text updated.
- 2026-07-05 (stage 3): Known gap (Forge): DNS_SERVERS intent extra is dead code — HybridNitroXrayCore never sets it; configurable TUN DNS wiring deferred to the cross-cutting security task in the plan.
- 2026-07-05 (stage 3): urlTest fast-refusal limitation accepted for MVP: a server that instantly refuses TCP ranks as fast; RN fetch can't introspect error cause. V2 = xray observatory.
- 2026-07-05 (hotfix): Device run threw ClassNotFoundException com.nitroxraycore.HybridNitroXrayCore. Root cause: post-script.js (create-nitro-module artifact) strips `margelo/nitro/` from the generated OnLoad.cpp JNI descriptor — a workaround for the OLD custom-package layout; the Kotlin impl has since moved to the standard com.margelo.nitro.nitroxraycore. Every `bun run codegen` re-broke the descriptor. Fix at ingestion: post-script.js neutered to a no-op (kept so the codegen script chain doesn't change), codegen re-run, descriptor verified `Lcom/margelo/nitro/nitroxraycore/HybridNitroXrayCore;`, Kotlin + C++ (CMake) library targets rebuilt clean.

- 2026-07-05 (stage 4): Gate 4.0 PASSED — olcrtc = WTFPL, olcbox = MIT, both SPDX-confirmed via GitHub API `/repos/.../license` (not just README claim; `/blob/main/LICENSE` 404'd because default branch is `master`). Both permissive, zero copyleft obligation → clear to bundle in a paid product. xray-core stays MPL-2.0 (modified xray files must ship as source). olcrtc last push 2026-05-23, not archived, still beta.
- 2026-07-05 (stage 4): Scope split (ApertureOscillation) — Stage 4 divides into config-layer chaining (pure TS, verifiable now via bun test) and native merge (rebuild committed libxray.so/xcframework, device-gated). Shipped the config layer this turn; native merge presented as plan, binaries NOT rebuilt blindly (irreversible + unverifiable here, per the Stage 3 hotfix lesson about unverified native claims).
- 2026-07-05 (stage 4): Forge review CONFIRMED-CORRECT on all points (dialerProxy location, auth-less socks shape, TLS-terminates-at-server, no tun loop). Non-blocking caveats logged: (1) UDP transports (mKCP/QUIC) via dialerProxy→SOCKS5 would need olcrtc UDP ASSOCIATE — current parsers/tested path is TCP-carried (vless+reality+tcp), doc-note only; (2) a non-loopback custom socksHost loses the OS loopback guarantee and would need VpnService.protect on-device — but that applies to every xray dial, not this feature. Default 127.0.0.1 is double-safe.
- 2026-07-05 (stage 4): FirstPrinciples confirmed from DESIGN_NOTES — xray→olcrtc chaining needs NO native glue: it's `streamSettings.sockopt.dialerProxy` on the proxy outbound → a `socks` outbound at olcrtc's local SOCKS5. Port is injected as `OlcrtcChainOptions.socksPort` (decoupled from the not-yet-existent native `getOlcrtcSocksPort()`), so the TS layer is complete and testable ahead of the merged binary.

- 2026-07-05 (stage 4.2): Merged Go-core builds — empirical resolution of the DESIGN_NOTES conjecture that two Go runtimes can't be linked. Correct model confirmed: ONE go-core module imports both `xtls/xray-core` and `openlibrecommunity/olcrtc/mobile`, compiles to ONE c-shared (48.5 MB android/arm64). `go get` bumped the toolchain 1.26.1→1.26.3 as a side effect. olcrtc's public API is its gomobile `mobile` package (`Start`/`WaitReady`/`Stop`/`IsRunning` + setters), so no gomobile-bind step is needed — plain cgo `//export` reuses it.
- 2026-07-05 (stage 4.2): Link failure `wlynxg/anet: invalid reference to net.zoneCache` on first build. Root cause: anet (transitive via pion/webrtc, Android net-iface enumeration) uses `//go:linkname` into runtime-internal `net.zoneCache`; Go 1.23+ rejects it. anet v0.0.5 is latest (no fix upstream). Resolved with linker flag `-checklinkname=0`, baked into build_android.sh so Илья's build won't re-break.

## Changelog (stage 3 hotfix)

- conjectured: `bun run codegen` is a safe, idempotent pipeline step.
  refuted_by: device ClassNotFoundException — post-script.js silently rewrote the freshly generated JNI descriptor to a package that no longer exists.
  learned: generated-code pipelines can contain stale "workaround" steps that invert into bugs when the thing they worked around is fixed; after any codegen, verify the JNI descriptor matches the actual Kotlin package.
  criterion_now: post-script.js is a documented no-op; grep `kJavaDescriptor` after codegen must yield `Lcom/margelo/nitro/nitroxraycore/HybridNitroXrayCore;`.

## Changelog

- conjectured: raw<lastRaw comparison is sufficient to detect engine restarts.
  refuted_by: Advisor + Forge convergent finding — backgrounded JS misses the dip when the new counter overtakes the old before the next sample, silently dropping the whole previous generation.
  learned: value-comparison heuristics need an authoritative signal; the state bus already carries one ('connecting'→'connected' brackets every restart).
  criterion_now: ISC-17/18 extended by suspend/commitRestart tests including the overtake case (session.test.ts "banks previous generation even when the new counter overtakes the old").

## Verification

- ISC-1..8: bun test — userinfo.test.ts 7 tests pass (34 pass total, 0 fail)
- ISC-9..13: tsc --noEmit clean; index.ts exports confirmed by Edit read-back
- ISC-14..20: bun test — session.test.ts 9 tests pass incl. suspend/commit/overtake cases
- ISC-21..24: client.ts wiring confirmed (ensureSessionStateHook + trafficSession().update + statsRaw passthrough)
- ISC-25..29: example tsc --noEmit exit 0; JSX confirmed by edits; on-device render — user-deferred by explicit request
- ISC-30: `bun test` → "34 pass, 0 fail, 89 expect() calls"
- ISC-31: `bun run typecheck` → tsc exit 0
- ISC-32/33: task edits limited to src/{client,index,stats,subscription} + example/App.tsx; specs/native diffs in working tree pre-date this task (user's in-flight refactor)
- ISC-34: original 18 parse.test.ts tests still pass within the 34
- ISC-35..37: spec edits + `bun run codegen` → "Generated 1/1 HybridObject", generated Kotlin/Swift signatures grep-verified
- ISC-38..40: KillSwitchStore.kt (SharedPreferences) + Hybrid impls + Swift stubs + XrayClient facade — Read/Grep confirmed; Kotlin compile via gradle `:react-native-nitro-xray-core:compileDebugKotlin` (see below)
- ISC-41..45: XrayVpnService flow code-verified (handleStartFailure hold path, establish-before-close ordering, STOP teardown, distinct error message); live device probe — user-deferred (checklist in docs/STAGE3_ANDROID.md)
- ISC-46/47: Grep — no setBlocking call; go-core untouched by this task
- ISC-48..56: bun test — urltest.test.ts 6 tests pass (sorting, error-latency, timeout→null+last, concurrency cap ≤3, empty list, custom probeUrl)
- ISC-57/58: docs/STAGE3_ANDROID.md written; IMPLEMENTATION_PLAN.md stage-3 status + deviation note
- ISC-59/60: bun test 40 pass / 0 fail; lib tsc clean; example tsc exit 0
- ISC-61: App.tsx — Switch toggle + Ping all + latency badges (Read-verified)
- ISC-62: prior 34 ISC tests all within the passing 40
