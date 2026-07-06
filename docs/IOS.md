# iOS implementation

Status: **device-verified on iPhone 11 / iOS 18.4.1.** iOS is at feature parity
with Android, including the olcrtc bypass.

## Architecture

Unlike Android (one `VpnService` process), iOS splits the work across two
processes:

- **App process** — `ios/HybridNitroXrayCore.swift` (the Nitro hybrid). Manages
  the VPN profile (`NETunnelProviderManager`), bridges state/stats to JS, and
  arms olcrtc. It does **not** run the engine.
- **Network Extension process** — `example/ios/tunnel/PacketTunnelProvider.swift`
  (`NEPacketTunnelProvider`). This is where the Go engine runs: it reads the
  config, sets up the TUN, and calls into `Xray.xcframework` (`StartXray`,
  `StartOlcrtc`, `QueryStats`, …). Separate process, ~50MB memory budget.

The two share data via an **App Group** (`group.<bundleid>`) and an encrypted
**Keychain access group** (`<AppIdentifierPrefix><bundleid>.shared`).

```
JS ── HybridNitroXrayCore (app) ──[App Group / Keychain + provider messages]──▶ PacketTunnelProvider (NE) ──▶ Xray.xcframework (Go)
```

## What's implemented

| Area | How |
|------|-----|
| start / stop | App writes config → NE `startTunnel` reads it → `StartXray(config, tunFd)` |
| connection state | `onStateChange` bridges `NEVPNStatusDidChange` → JS (correct after app restart) |
| traffic stats | `getStats` → `sendProviderMessage {cmd:stats}` → NE `QueryStats` → JSON back |
| version | same provider-message channel (`{cmd:version}`) |
| kill switch | `NEOnDemandRule` + `includeAllNetworks` (fail-closed), persisted, re-applied on every profile write |
| config secrets | **Keychain** (encrypted, device-bound `AfterFirstUnlockThisDeviceOnly`); App Group is a fallback |
| DNS | derived from the config's `dns.servers` (valid IPs only), neutral fallback |
| TUN fd | highest `utun` fd (our tunnel is newest), KVC fallback |
| olcrtc bypass | see below |

## olcrtc on iOS

olcrtc runs **inside the NE** (that's where the merged core loads), not the app
process — so it can't start before the tunnel exists. The flow (JS API is
identical to Android — `startOlcrtc` → `connect`):

1. `startOlcrtc(cfg)` in the app **records** the client config and resolves the
   SOCKS port (10808). Nothing starts yet.
2. `connect(server, { olcrtc: { socksPort } })` (or `connectOlcrtcOnly`) builds a
   config whose proxy outbound dials through `dialerProxy → 127.0.0.1:10808`.
   `startXray` **embeds** the olcrtc client params as a top-level `olcrtc` block.
3. NE `startTunnel`: if the config has an `olcrtc` block, it starts olcrtc
   **on a background queue** (SOCKS-only, no TUN), then starts xray immediately
   and completes. xray dials the server through olcrtc; those dials retry until
   olcrtc's SOCKS is up.

**Why background start matters:** olcrtc's WebRTC handshake + retries can take
tens of seconds (flaky carrier TURN/ICE). If `StartOlcrtc` blocked `startTunnel`
that long, iOS would kill the NE. Starting it in the background keeps the tunnel
alive; olcrtc comes up shortly after.

**Memory:** the merged xray+olcrtc+pion runtime peaks at **~57MB** RSS in the NE.
The iOS 15+ packet-tunnel budget is ~50MB (not the old 15MB), so this is over
nominal but survives in practice on iOS 18. It is **not cheaply reducible** —
the footprint is active (mapped code + live WebRTC working set), so
`FreeOSMemory()` nets ~0. The only lever left is trimming xray's `distro/all`
imports to shrink resident code (deferred: risky, low payoff). olcrtc-iOS ships
as-is at ~57MB.

## Build, sign, install

VPN (Network Extension) needs a **paid Apple Developer account** and a **real
device** — it does not run in the Simulator.

```bash
# one command: build (Release, JS bundle embedded), sign, install to a connected iPhone
scripts/ios-device.sh              # Release (standalone, no Metro) — default
scripts/ios-device.sh --debug      # Debug (needs this repo's Metro running)
scripts/ios-device.sh --build-only # build + sign, skip install
```

The script auto-detects the iPhone, uses automatic signing under team
`4548L5D8WL`, and passes `STRIP_INSTALLED_PRODUCT=NO` (Apple `strip` can't
process the Go static archive).

Rebuild the native core (`ios/Xray.xcframework`) only when Go changes:

```bash
cd go-core && bash build_ios.sh    # xray + olcrtc, device + simulator slices
```

## Setup gotchas

- **Apple ID / team.** The project signs under team `4548L5D8WL`. That Apple ID
  must be logged into Xcode (Settings → Accounts) with a valid session; a stale
  session fails with "Unable to log in / No profiles found".
- **First launch — "unable to verify app, network required".** iOS verifies the
  dev signature online. If the **kill switch** was on (`includeAllNetworks` +
  on-demand) and the tunnel isn't actually passing traffic, the phone has no
  internet and can't verify. Recovery: Settings → General → VPN & Device
  Management → turn the VPN off (and Connect-On-Demand off), or delete the
  profile; give the phone real Wi-Fi; relaunch. Don't enable kill switch until
  the tunnel is confirmed working.
- **Re-creating the VPN profile.** Deleting it is safe — the app re-creates it on
  the next connect (or when the olcrtc toggle is enabled), and iOS re-prompts
  "Allow VPN configuration".
- **RN version mismatch on launch** ("JavaScript 0.85.3 / Native 0.84.1") means a
  Debug build attached to a *different project's* Metro. Use the Release build
  (default) — the JS bundle is embedded, no Metro.
- **RSS in logs shows `<private>`** — os_log redacts interpolated values; use
  `privacy: .public` or `NSLog`. Read NE logs with
  `idevicesyslog -u <udid>` (macOS has no `timeout`; `devicectl` has no console
  subcommand).

## Not done

- Trim `distro/all` to shrink the iOS binary / RSS (deferred — risky, low payoff).
