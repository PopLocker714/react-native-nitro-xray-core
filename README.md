# react-native-nitro-xray-core

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

### Basic Usage

```typescript
import { XrayEngine } from 'react-native-nitro-xray-core';

// Start the engine
const configJsonString = '{ ... }'; // Your Xray JSON config
const tunFd = 123; // Android TUN File Descriptor (or -1/0 for proxy mode)

const status = XrayEngine.start(configJsonString, tunFd);

if (status === 0) {
  console.log("Xray started successfully!");
}

// Stop the engine
XrayEngine.stop();
```

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
