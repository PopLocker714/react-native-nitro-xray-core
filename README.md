# react-native-nitro-xray-core

Begin development:

   Define your module:
   src/specs/               # Define your module specifications. e.g. src/specs/myModule.nitro.ts
   bun run codegen         # Generates native interfaces from TypeScript definitions

   Implement native code:
   ios/                     # iOS native implementation using swift
   android/                 # Android native implementation using kotlin
   cpp/                     # C++ native implementation. Shareable between iOS and Android (Will be generated if c++ was selected)

Run your example app to test the package:

   cd example
   bun run pod             # Install CocoaPods dependencies (iOS)
   bun run ios|android     # Run your example app

Pro Tips:
• iOS: Open example/ios/example.xcworkspace in Xcode for native debugging. Make sure to run bun pod first in the example directory
• Android: Open example/android in Android Studio
• Metro: Clear cache with bun start if needed

Need help? Create an issue: https://github.com/patrickkabwe/create-nitro-module/issues

Love this tool? Leave a ⭐️ on https://github.com/patrickkabwe/create-nitro-module

◇  Create Nitro Module - A CLI tool that simplifies creating React Native modules powered by Nitro Modules.

react-native-nitro-xray-core is a react native package built with Nitro

[![Version](https://img.shields.io/npm/v/react-native-nitro-xray-core.svg)](https://www.npmjs.com/package/react-native-nitro-xray-core)
[![Downloads](https://img.shields.io/npm/dm/react-native-nitro-xray-core.svg)](https://www.npmjs.com/package/react-native-nitro-xray-core)
[![License](https://img.shields.io/npm/l/react-native-nitro-xray-core.svg)](https://github.com/patrickkabwe/react-native-nitro-xray-core/LICENSE)

## Requirements

- React Native v0.76.0 or higher
- Node 18.0.0 or higher

> [!IMPORTANT]  
> To Support `Nitro Views` you need to install React Native version v0.78.0 or higher.

## Installation

```bash
bun add react-native-nitro-xray-core react-native-nitro-modules
```

## Credits

Bootstrapped with [create-nitro-module](https://github.com/patrickkabwe/create-nitro-module).

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.
