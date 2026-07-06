# react-native-nitro-xray-core (rc)

[![npm version](https://img.shields.io/npm/v/react-native-nitro-xray-core.svg?style=flat-square)](https://www.npmjs.com/package/react-native-nitro-xray-core)
[![npm license](https://img.shields.io/npm/l/react-native-nitro-xray-core.svg?style=flat-square)](https://github.com/PopLocker714/react-native-nitro-xray-core/blob/master/LICENSE)
[![Build Android](https://github.com/PopLocker714/react-native-nitro-xray-core/actions/workflows/android-build.yml/badge.svg)](https://github.com/PopLocker714/react-native-nitro-xray-core/actions/workflows/android-build.yml)
[![Build iOS](https://github.com/PopLocker714/react-native-nitro-xray-core/actions/workflows/ios-build.yml/badge.svg)](https://github.com/PopLocker714/react-native-nitro-xray-core/actions/workflows/ios-build.yml)

DO NOT USE IN PRODUCTION!!!

A high-performance React Native VPN library powered by the Xray-core engine. Built with Nitro modules for maximum performance and zero C++ bridge overhead.

## 🚀 Getting Started (For App Developers)

If you just want to use the VPN engine in your React Native app, follow these steps.

### Requirements
- React Native v0.76.0 or higher
- Node 18.0.0 or higher

### Installation

```bash
bun add react-native-nitro-xray-core react-native-nitro-modules
```

*(Note: The native Android libraries are pre-compiled and bundled into the package. You do **not** need to install Go or native NDK tools to use this library in your App).*

## ✨ Features

Both platforms are device-verified (Android + iOS). iOS runs the engine in a
Network Extension — see **[docs/IOS.md](docs/IOS.md)** for the iOS setup.

- **Full Xray-core transport support** — VLESS / VMess / Trojan / Shadowsocks over
  TCP / WS / gRPC / HTTPUpgrade / XHTTP / mKCP / h2, with TLS / Reality / XTLS-Vision.
- **Subscription parsing (pure TS)** — `vless://` / `vmess://` / `ss://` / `trojan://`
  share links, base64 subscriptions, and the `subscription-userinfo` quota/expiry header.
- **Typed config builder** — turn a parsed server into a full Xray JSON config; raw
  JSON stays available as an escape hatch.
- **Connection state + traffic stats** — `connecting/connected/error` events and
  session-continuous up/down counters that survive server switches.
- **URLTest** — probe server latency and sort fastest-first.
- **Kill switch** — Android holds the TUN as a blackhole on engine failure (fail-closed);
  iOS uses `NEOnDemandRule` + `includeAllNetworks`.
- **Configurable foreground notification** (Android) — title/text/Disconnect button,
  translatable at runtime.
- **olcrtc bypass** — tunnel through a whitelisted WebRTC side-channel (Russia bypass):
  `device → xray → olcrtc → your server`. Android + iOS.

## Basic Usage

`XrayClient` is the recommended high-level entry point.

```typescript
import { XrayClient } from 'react-native-nitro-xray-core';

// 1. Load servers from a subscription
const servers = await XrayClient.fromSubscription('https://example.com/sub');

// 2. Ensure VPN permission, then connect to a server
await XrayClient.ensurePermission();
await XrayClient.connect(servers[0]);

// 3. Observe state + live traffic
const unsub = XrayClient.onState((state, msg) => console.log(state, msg));
const { uplink, downlink } = await XrayClient.stats();

// 4. Disconnect
await XrayClient.disconnect();
```

## API (`XrayClient`)

**Subscriptions & config**
- `parseLink(uri)` / `parseSubscription(payload)` → `ParsedServer[]`
- `fromSubscription(url, init?)` → `ParsedServer[]`
- `fromSubscriptionWithInfo(url, init?)` → `{ servers, info }` (quota/expiry)
- `buildConfig(server, options?)` → raw Xray config object

**Connect**
- `ensurePermission()` — request VPN permission if needed
- `connect(server, options?)` — build config + start the tunnel
- `startRaw(configJson)` — start from hand-written Xray JSON
- `disconnect()` / `isConnected()`
- `onState(listener)` → unsubscribe fn (`disconnected/connecting/connected/disconnecting/error`)

**Stats & info**
- `stats(tag?)` → session-continuous `{ uplink, downlink }` (survives server switches)
- `statsRaw(tag?)` → raw per-engine counters
- `version()` — Xray-core version
- `urlTest(servers, options?)` → latency-sorted results

**Kill switch & notification**
- `setKillSwitch(enabled)` / `isKillSwitchEnabled()`
- `setNotificationConfig({ title?, text?, disconnectLabel?, ... })` (Android; translatable)
- `requestNotificationPermission()` (Android 13+)

**olcrtc bypass**
- `startOlcrtc(config)` — start the WebRTC side-channel client (SOCKS5)
- `getOlcrtcSocksPort()` / `isOlcrtcRunning()` / `stopOlcrtc()`
- `connect(server, { olcrtc: { socksPort } })` — route the server dial through olcrtc
- `connectOlcrtcOnly(options?)` — tunnel straight through olcrtc, no VLESS server

```typescript
// olcrtc: start the side-channel, then chain the server through it
await XrayClient.startOlcrtc({
  carrier: 'wbstream',        // whitelisted carrier the tunnel rides on
  transport: 'vp8channel',    // must match your olcrtc server
  roomId: '<room-uuid>',      // from the carrier
  keyHex: '<64-hex key>',     // shared with the server
  clientId: 'device-1',
});
const port = XrayClient.getOlcrtcSocksPort();
await XrayClient.connect(servers[0], { olcrtc: { socksPort: port } });
```

The olcrtc **server** is deployed separately — see **[deploy/olcrtc](deploy/olcrtc)**.

---

## 🍏 iOS Setup Guide (Network Extension)

To use `react-native-nitro-xray-core` on iOS, you cannot simply run it in the main application. Apple requires VPN processes to run inside a separate background target known as a **Network Extension (Packet Tunnel Provider)**. Due to strict iOS security and memory limits (15 MB Jetsam limit), follow these steps precisely:

### 1. Capabilities & Identifiers
Go to the **Apple Developer Portal** and configure your App ID:
- Add the **Network Extension** capability and check **Packet Tunnel**.
- Add the **App Groups** capability (e.g., `group.com.yourcompany.app`).
- Create a *second* App ID for your tunnel (e.g., `com.yourcompany.app.tunnel`) and assign it the **same** App Group and Network Extension capabilities.

### 2. Create the Extension Target in Xcode
1. In Xcode, go to **File > New > Target...**
2. Choose **Network Extension** and select **Packet Tunnel Provider**. Name it `tunnel`.
3. In the project settings for the `tunnel` target, under **Signing & Capabilities**, add **App Groups** and **Network Extension** (check Packet Tunnel). Match the App Group ID with your main app.

### 3. Link the Pre-Compiled Xray Core
1. Locate `Xray.xcframework` in the `node_modules/react-native-nitro-xray-core/ios/` directory (or build it via the `go-core` script).
2. Select your `tunnel` target, go to **General > Frameworks and Libraries**.
3. Add `Xray.xcframework` and ensure it is set to **Embed & Sign**.
4. Also add `NetworkExtension.framework` and `libresolv.tbd` (required for DNS).

### 4. Critical Build Settings for the `tunnel` Target
- **Deployment Target**: Ensure `IPHONEOS_DEPLOYMENT_TARGET` is set accurately (e.g., `15.1`). *If you set it to a future iOS version, iOS will refuse to launch the extension, flag it as "Needs Update", and kill the process with `SIGKILL`.*
- **Memory Limit**: Network Extensions have a strict 15MB RAM limit on iOS. Our Go binary is tuned via `main_ios.go` (`debug.SetMemoryLimit(14MB)` and `GOGC=10`) to survive, but ensure **no React Native frameworks (like React.framework)** are accidentally linked to the `tunnel` target, or you will immediately crash on startup.
- **Replace PacketTunnelProvider.swift**
1. Replace yore ios/tunnel/PacketTunnelProvider.swift on example/ios/tunnel/PacketTunnelProvider.swift
2. change identifiers
```swift
private let kAppGroup  = "group.com.xraycore.example"
private let logger = Logger(subsystem: "com.xraycore.example.tunnel", category: "PacketTunnel")
```
- **Set Bridging Header**:  
1. Select your `tunnel` target, go to **Build Settings > Filter** write `Bridging Header`.
2. Set Debug and Release:  `$(SRCROOT)/tunnel/tunnel-Bridging-Header.h`


### 5. Modify PacketTunnelProvider.swift
Use the provided `HybridNitroXrayCore.swift` (main app) to negotiate permissions and launch the VPN. In your `tunnel` folder, edit `PacketTunnelProvider.swift` to invoke the C-bridge `StartXray(config, fd)` method. Xray will bind to the TUN interface automatically. 

*(See the `example/ios/tunnel/PacketTunnelProvider.swift` in this repository for a complete production-ready implementation that falls back to `options` if App Groups fail for free Apple IDs).*

---

## 🛠 Advanced (For Library Contributors)

If you want to contribute to the package, edit the native code, or update the internal Go engine, read below.

### 1. Local Setup
```bash
# Clone the repository
git clone https://github.com/yourname/react-native-nitro-xray-core.git
cd react-native-nitro-xray-core

# Install dependencies
bun install

# Generate native Nitro interfaces from TypeScript
bun run codegen
```

### 2. Running the Example App
There is a built-in `example` app that helps you test your changes live:
```bash
cd example
bun install

# Run on Android Emulator
bun run android
```

### 3. Updating the internal Xray-Core Engine

This project uses Go Modules to automatically manage the `Xray-core` dependency without bloating the repository. The Go bridge code is located in the `go-core` directory.

To update the Xray-core engine to the latest version and recompile the Android binaries (`.so`), run the following commands:

```bash
# Navigate to the Go bridge directory
cd go-core

# 1. Download the latest version of Xray-core into go.mod
go get github.com/xtls/xray-core@latest

# 2. Recompile the native Android binaries (.so) for all architectures
# (Make sure ANDROID_NDK_HOME is exported in your environment)
./build_android.sh
```

**Note:** The generated `.so` binaries for `arm64-v8a`, `armeabi-v7a`, `x86_64`, and `x86` will be placed in `android/src/main/jniLibs`. These pre-compiled files must be committed to Git and bundled with the NPM package so end-users don't need a Go installation.

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.
