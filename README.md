# react-native-nitro-xray-core

[![npm version](https://img.shields.io/npm/v/react-native-nitro-xray-core.svg?style=flat-square)](https://www.npmjs.com/package/react-native-nitro-xray-core)
[![npm license](https://img.shields.io/npm/l/react-native-nitro-xray-core.svg?style=flat-square)](https://github.com/PopLocker714/react-native-nitro-xray-core/blob/master/LICENSE)
[![Build Android](https://github.com/PopLocker714/react-native-nitro-xray-core/actions/workflows/android-build.yml/badge.svg)](https://github.com/PopLocker714/react-native-nitro-xray-core/actions/workflows/android-build.yml)
[![Build iOS](https://github.com/PopLocker714/react-native-nitro-xray-core/actions/workflows/ios-build.yml/badge.svg)](https://github.com/PopLocker714/react-native-nitro-xray-core/actions/workflows/ios-build.yml)

A high-performance **VPN engine for React Native** powered by [Xray-core](https://github.com/XTLS/Xray-core),
with an optional [olcrtc](https://github.com/openlibrecommunity/olcrtc) WebRTC
side-channel for censorship circumvention. Built on [Nitro Modules](https://github.com/mrousavy/nitro)
for zero-bridge native performance.

Device-verified on **Android** and **iOS** (Network Extension).

> ⚠️ **Early stage.** The API is stabilizing and olcrtc is alpha. Pin the version
> and test on real devices before shipping.

## What is this?

- **[Xray-core](https://github.com/XTLS/Xray-core)** is a powerful proxy platform
  (the VLESS/VMess/Trojan/Reality ecosystem). This library embeds the real Go
  engine and drives it from JS — so you get the *full* protocol/transport surface,
  not a re-implementation. You point it at a server (usually from a subscription),
  it raises a TUN and routes device traffic through the proxy.

- **[olcrtc](https://github.com/openlibrecommunity/olcrtc)** tunnels traffic
  through a **whitelisted WebRTC service** (e.g. video-call carriers) that stays
  reachable even where normal proxies are blocked. It exposes a local SOCKS5 that
  Xray dials through — so the whole chain is `device → Xray → olcrtc → your server`.
  The proxy handshake rides *inside* the allowed WebRTC channel, so the carrier
  only sees whitelisted traffic. This is the optional "bypass" path.

## ✨ Features

- **Full Xray-core transports** — VLESS / VMess / Trojan / Shadowsocks over
  TCP / WS / gRPC / HTTPUpgrade / XHTTP / mKCP / h2, with TLS / Reality / XTLS-Vision.
- **Subscription parsing (pure TS)** — `vless://` / `vmess://` / `ss://` / `trojan://`
  links, base64 subscriptions, and the `subscription-userinfo` quota/expiry header.
- **Typed config builder** — a parsed server → a full Xray JSON config. Raw JSON
  stays available as an escape hatch.
- **State + traffic stats** — `connecting/connected/error` events and
  session-continuous up/down counters that survive server switches.
- **URLTest** — probe server latency and sort fastest-first.
- **Kill switch** — fail-closed: Android holds the TUN as a blackhole on engine
  failure; iOS uses `NEOnDemandRule` + `includeAllNetworks`.
- **Configurable foreground notification** (Android) — title / text / Disconnect
  button, translatable at runtime.
- **olcrtc bypass** — WebRTC side-channel, chained or standalone. Android + iOS.

## Installation

```bash
bun add react-native-nitro-xray-core react-native-nitro-modules
# or: npm install / yarn add
```

The native Android binaries are pre-compiled and bundled — you do **not** need Go
or the NDK to use the library. iOS requires a one-time Network Extension setup
(see [docs/IOS.md](docs/IOS.md)).

## Quick start

`XrayClient` is the recommended high-level entry point.

```typescript
import { XrayClient } from 'react-native-nitro-xray-core';

// 1. Load servers from a subscription URL
const servers = await XrayClient.fromSubscription('https://example.com/sub');

// 2. Ask for VPN permission, then connect
await XrayClient.ensurePermission();
await XrayClient.connect(servers[0]);

// 3. Observe state + live traffic
const unsub = XrayClient.onState((state, msg) => console.log(state, msg));
const { uplink, downlink } = await XrayClient.stats();

// 4. Disconnect
await XrayClient.disconnect();
unsub();
```

## Examples

### Subscription with quota/expiry

```typescript
const { servers, info } = await XrayClient.fromSubscriptionWithInfo(SUB_URL);
if (info?.total) {
  const used = (info.upload ?? 0) + (info.download ?? 0);
  console.log(`Used ${used} / ${info.total} bytes`);
}
```

### Pick the fastest server

```typescript
const ranked = await XrayClient.urlTest(servers);      // fastest first, dead last
await XrayClient.connect(ranked[0].server);
```

### Kill switch + notification (Android)

```typescript
await XrayClient.setKillSwitch(true);                   // block traffic if the engine dies
XrayClient.setNotificationConfig({
  title: 'My VPN',
  text: 'Connected — traffic protected',
  disconnectLabel: 'Disconnect',                        // shown as a notification action
});
```

### olcrtc bypass — chain a server through the WebRTC side-channel

```typescript
// Start olcrtc (local SOCKS5), then route the server dial through it.
await XrayClient.startOlcrtc({
  carrier: 'wbstream',        // whitelisted carrier the tunnel rides on
  transport: 'vp8channel',    // must match your olcrtc server
  roomId: '<room-uuid>',      // created on the carrier
  keyHex: '<64-hex key>',     // shared secret with the server
  clientId: 'device-1',
});
const port = XrayClient.getOlcrtcSocksPort();
await XrayClient.connect(servers[0], { olcrtc: { socksPort: port } });
```

### olcrtc-only — tunnel straight through olcrtc, no VLESS server

```typescript
await XrayClient.startOlcrtc({ carrier: 'wbstream', transport: 'vp8channel',
  roomId: '<room-uuid>', keyHex: '<key>', clientId: 'device-1' });
await XrayClient.connectOlcrtcOnly();                   // device → Xray-TUN → olcrtc → server
```

The olcrtc **server** is deployed separately — see [deploy/olcrtc](deploy/olcrtc)
for a ready Docker setup.

## API (`XrayClient`)

**Subscriptions & config**
- `parseLink(uri)` / `parseSubscription(payload)` → `ParsedServer[]`
- `fromSubscription(url, init?)` → `ParsedServer[]`
- `fromSubscriptionWithInfo(url, init?)` → `{ servers, info }`
- `buildConfig(server, options?)` → raw Xray config object

**Connect**
- `ensurePermission()` — request VPN permission if needed
- `connect(server, options?)` — build config + start the tunnel
- `startRaw(configJson)` — start from hand-written Xray JSON
- `disconnect()` / `isConnected()`
- `onState(listener)` → unsubscribe fn (`disconnected/connecting/connected/disconnecting/error`)

**Stats & info**
- `stats(tag?)` → session-continuous `{ uplink, downlink }`
- `statsRaw(tag?)` → raw per-engine counters
- `version()` — Xray-core version
- `urlTest(servers, options?)` → latency-sorted results

**Kill switch & notification**
- `setKillSwitch(enabled)` / `isKillSwitchEnabled()`
- `setNotificationConfig({ title?, text?, disconnectLabel?, ... })` (Android)
- `requestNotificationPermission()` (Android 13+)

**olcrtc bypass**
- `startOlcrtc(config)` / `stopOlcrtc()`
- `getOlcrtcSocksPort()` / `isOlcrtcRunning()`
- `connect(server, { olcrtc: { socksPort } })` — chained
- `connectOlcrtcOnly(options?)` — standalone

## iOS setup

iOS runs the engine inside a **Network Extension** (a separate process with its
own memory budget), so it needs a one-time Xcode + Apple Developer setup (App
Group, Packet Tunnel target, linking `Xray.xcframework`). A paid Apple Developer
account and a real device are required — the Simulator can't run a VPN.

👉 Full step-by-step guide: **[docs/IOS.md](docs/IOS.md)**.

## Building from source (contributors)

You only need this to change the native Go engine — app developers use the
pre-built binaries.

```bash
git clone https://github.com/PopLocker714/react-native-nitro-xray-core.git
cd react-native-nitro-xray-core
bun install
bun run codegen            # regenerate Nitro native interfaces from the TS spec

# rebuild the native engines (needs Go; Android needs ANDROID_NDK_HOME)
cd go-core
./build_android.sh         # arm64-v8a + armeabi-v7a → android/src/main/jniLibs
./build_ios.sh             # Xray.xcframework (arm64 device + arm64 simulator)
```

Run the example app: `cd example && bun install && bun run android` (or
`scripts/ios-device.sh` for a signed device build).

## Credits & acknowledgements

This library stands on the shoulders of excellent open-source work — huge thanks
to their authors and communities:

- **[Xray-core](https://github.com/XTLS/Xray-core)** (XTLS) — the proxy engine at
  the heart of this library.
- **[olcrtc](https://github.com/openlibrecommunity/olcrtc)** (openlibrecommunity)
  — the WebRTC side-channel that makes the bypass path possible.
- **[Nitro Modules](https://github.com/mrousavy/nitro)** (Marc Rousavy) — the
  native module framework this is built on.

## License

MIT — see [LICENSE](LICENSE). Xray-core is MPL-2.0 and olcrtc is WTFPL; their
respective licenses apply to the bundled/linked components.
