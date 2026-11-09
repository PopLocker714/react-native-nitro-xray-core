# Native diagnostics foundation (unreleased source)

This task changes the native ABI. Package version stays 1.7.0; the published
1.7.0 binaries do **not** contain this implementation. Do not ship these sources
with stale generated bindings/artifacts or distribute them through OTA alone.

```ts
import { getDiagnosticSnapshot, clearDiagnostics, getSystemVpnStatus } from 'react-native-nitro-xray-core'
const page = await getDiagnosticSnapshot(0)
if (page.available) {
  // page.events: fixed codes only; page.more + page.next paginate retained events
  // page.probe === 'unavailable'; no data-plane diagnosis is supported
}
const cleared = await clearDiagnostics() // available=false if native/NE cannot answer
const system = getSystemVpnStatus()
```

The public wrapper validates every field, rejects unknown keys and free text, and
returns `{available:false}` for old binaries, unsupported methods, malformed DTOs,
or unreachable NE. Invalid cursors throw RangeError. Direct Nitro methods are
low-level transport, not validated report DTOs. Clear is a live-process operation;
it does not reset sequence/attempt identity. Do not infer a VPN failure from a
missing diagnostics capability or an IPC timeout.

## Privacy, bounds and meaning

No logcat/syslog/stderr collection. RegisterHandlerCreator is installed before
core.New (pinned Xray 5ca6f4b7d4dc); the effective logger policy disables access/DNS
and raw console/file writers even for consumer raw configs. Only exact known
lifecycle messages enter the buffer. Both olcrtc platforms use SetLogWriter;
unknown lines are discarded and counted. Narrow allowlist intentionally misses
unclassified upstream errors. Go wrapper calls supply explicit parse/init/start/
stop outcomes without exception text. Retry warnings are separate from exhausted
start_failed/proxy_timeout outcomes. No telemetry/report-delivery dependency.

Each engine process retains at most 1024 events / 256 KiB serialized event bytes,
512 bytes per entry, TTL 10 minutes. Heap/allocator overhead is additional. Pages
have a 28 KiB event budget and remain under 32 KiB including envelope. Noisy logs
have a 896-event / 192 KiB budget; errors/fatal survive lower-severity floods.
If terminal events alone fill the ring, oldest terminal events are evicted.
`dropped` includes expiry, eviction and unknown lines; `truncated` counts oversized
entries (fixed DTOs should never hit this). Pagination is best effort under writes;
check dropped and sequence gaps. Clear/append/read are mutex protected.

Sources: app/xray/olcrtc. Producers: android_service/ios_ne/go (ios_app reserved,
no separate app-process buffer). UTC is wall time; elapsedMs is Go monotonic time.
clockScope is process-local; never subtract elapsed across scopes. Cursors belong
to one process: restart requires cursor=0. Attempt is a process-local counter,
not an app/account ID. Native service/widget/system and NE starts create attempts;
wrapper outcomes capture the attempt before blocking. Asynchronous upstream logs
have attempt=0 (unattributable). Android JS-started olcrtc can precede the service
attempt and therefore also have attempt=0. No JS/cross-process correlation is
invented. engine_started and proxy_ready do not prove traffic or TUN readiness.

NE IPC: diagnostics with integer after cursor, clearDiagnostics. Input <=256 B,
response <=32 KiB, app timeout 2 seconds, exactly one Promise completion. Both real
consumer provider and SDK example contain the seam. A protected atomic App Group
native-diagnostics.json checkpoint stores only the latest bounded sanitized page
at start/engine outcome/stop/snapshot boundaries, excluded from backup. Abrupt kill
can lose later events. No raw stderr reader or automatic checkpoint upload exists.
When live NE is unavailable, cursor=0 can read this bounded checkpoint for up to
72 hours. The validated public page includes checkpointUtc; historical pages
must never trigger automatic live-failure diagnosis. Clear still requires live NE;
report delivery is the consumer's responsibility.

## Android Always-on

App killSwitch is independent from system Always-on and lockdown. The system
SERVICE_INTERFACE intent can replay only an opted-in QuickConnectStore payload.
API29+ additionally requires isAlwaysOn. Null sticky restart replays only when
API29+ reports Always-on. API24–28 cannot query Always-on/lockdown: status is null;
only explicit system action can replay, ambiguous null intents stop safely.
No payload, disabled quick-connect, logout/clear or manual-stop suppression means
no replay and no direct fallback. Explicit app/widget start rearms replay.
Cold widget replay remains available after manual stop. Call clearStoredConfig
after stopXray on logout. Configure quick-connect opt-in and connect successfully
before enabling OS Always-on; the SDK never silently persists credentials.
Manual suppression survives restart. To resume system replay, start explicitly.

getSystemVpnStatus returns supported plus alwaysOn/lockdown (null when unknown,
including when no live service is available). A false app toggle says nothing
about these OS settings. UI may open Android Settings.ACTION_VPN_SETTINGS
(`android.settings.VPN_SETTINGS`) using its own activity launcher; handle missing
activity and let the user choose Always-on/block-without-VPN. SDK does not toggle
OS settings. iOS on-demand/includeAllNetworks behavior is unchanged.

No verified TUN probe is provided. Android RN fetch uses excluded-app underlay.
Idle, zero counters, one ping, RN fetch and engine_chain cannot prove TUN loss.
No automatic report delivery or data_plane_loss classification is enabled.

## Validation and remaining release gates

The first remote run [42596289093](https://github.com/PopLocker714/react-native-nitro-xray-core/actions/runs/42596289093)
passed Nitrogen, TypeScript, 114 Bun tests, Go collector race tests and the Kotlin
replay policy runner. It also built device/simulator iOS archives. Generated
bindings and those archives/headers were imported and verified against the CI
artifact hashes. Nitrogen emits trailing whitespace; generated files are preserved
verbatim. The current local suite has 115 tests including checkpoint validation.

The next source revision is under [42597366177](https://github.com/PopLocker714/react-native-nitro-xray-core/actions/runs/42597366177).
It fixes SDK setup (the removed Android package `tools` must not be requested),
builds all four Android ABIs, and compiles Android/iOS example consumers against
matching bindings and native artifacts. This run is still pending at this edit;
Android libraries and bridge/NE builds are not yet claimed passing.

The iOS provider now uses strong C references instead of dlsym, so diagnostics
symbols are retained without relying on dynamic export/dead-strip configuration.
The provider requires the matching regenerated Go header/archive. Old **installed**
SDKs still return unavailable through the JS optional-capability wrapper.
Android JNI optional symbols must be checked in the regenerated shared libraries.

Device release gates remain: API24/28/29+ SERVICE_INTERFACE, null restart, OS
Always-on on/off, lockdown, process death/boot, manual stop, widget replay, missing
config, logout and stop/start races. Verify no phantom replay/direct fallback.
Verify NE reply bounds/timeout, checkpoint protection/expiry, live-vs-historical
labeling and old installed binary behavior. No npm release, store rollout or OTA
has occurred for this implementation. The app must acquire a new native binary.

The manual branch-only workflow generates reusable artifacts without publication.
Local heavy builds are blocked by the Mac resource guard; do not weaken it to
complete these checks. Build recipes: go-core/build_ios.sh and the pinned Android
matrix in .github/workflows/native-diagnostics-validation.yml.

Primary sources: [Android VpnService](https://developer.android.com/reference/android/net/VpnService),
[Android VPN guide](https://developer.android.com/develop/connectivity/vpn),
[pinned Xray logger](https://github.com/XTLS/Xray-core/blob/5ca6f4b7d4dc/app/log/log.go),
[pinned handler seam](https://github.com/XTLS/Xray-core/blob/5ca6f4b7d4dc/app/log/log_creator.go),
[pinned olcrtc writer](https://github.com/openlibrecommunity/olcrtc/blob/1255cf8248ee/mobile/mobile.go).
