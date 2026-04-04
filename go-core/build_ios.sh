#!/bin/bash
set -e

# ============================================================
# build_ios.sh — Build Xray.xcframework for iOS
# Output: ../ios/Xray.xcframework
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_ROOT="$SCRIPT_DIR/.."
OUTPUT_XCFRAMEWORK="$MODULE_ROOT/ios/Xray.xcframework"
BUILD_TMP="$SCRIPT_DIR/.build_ios_tmp"

echo "============================================================"
echo " Building Xray.xcframework for iOS"
echo "============================================================"

# Verify Go is installed
if ! command -v go &>/dev/null; then
  echo "ERROR: 'go' not found. Install Go from https://go.dev/dl/"
  exit 1
fi

go version
echo ""

# Verify Xcode Command Line Tools
if ! command -v xcrun &>/dev/null; then
  echo "ERROR: Xcode Command Line Tools not found. Run: xcode-select --install"
  exit 1
fi

# Clean previous build
rm -rf "$BUILD_TMP"
rm -rf "$OUTPUT_XCFRAMEWORK"
mkdir -p "$BUILD_TMP"

# ============================================================
# Helper: build a .a static lib for a given target
# ============================================================
build_slice() {
  local LABEL="$1"       # e.g. "arm64-device"
  local GOOS="$2"        # "ios"
  local GOARCH="$3"      # "arm64" or "amd64"
  local TARGET="$4"      # apple clang target triple
  local OUT_DIR="$BUILD_TMP/$LABEL"

  echo "-----------------------------------------------------------"
  echo "Building: $LABEL  (GOARCH=$GOARCH, TARGET=$TARGET)"

  mkdir -p "$OUT_DIR"

  # Apple SDK path
  if [[ "$LABEL" == *simulator* ]]; then
    SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
  else
    SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
  fi

  export GOOS="$GOOS"
  export GOARCH="$GOARCH"
  export CGO_ENABLED=1
  export CC="$(xcrun --sdk "${SDK##*/}" -f clang 2>/dev/null || xcrun -f clang)"
  export CGO_CFLAGS="-target $TARGET -isysroot $SDK -miphoneos-version-min=14.0"
  export CGO_LDFLAGS="-target $TARGET -isysroot $SDK"
  # For simulator builds, GOARCH=amd64 is x86_64; arm64 simulator needs special tag
  if [[ "$LABEL" == *"arm64-simulator"* ]]; then
    export GOARCH="arm64"
    export CGO_CFLAGS="-target arm64-apple-ios14.0-simulator -isysroot $SDK -miphoneos-version-min=14.0"
    export CGO_LDFLAGS="-target arm64-apple-ios14.0-simulator -isysroot $SDK"
  fi

  cd "$SCRIPT_DIR"
  go build \
    -tags ios \
    -trimpath \
    -buildmode=c-archive \
    -ldflags="-s -w" \
    -o "$OUT_DIR/libxray.a" \
    ./libxray

  echo " → $OUT_DIR/libxray.a"
}

# ============================================================
# Build all slices
# ============================================================
cd "$SCRIPT_DIR"

# 1. arm64 — physical iOS devices
build_slice "arm64-device" \
  "ios" "arm64" \
  "arm64-apple-ios14.0"

# 2. x86_64 — Intel Mac simulator
build_slice "x86_64-simulator" \
  "ios" "amd64" \
  "x86_64-apple-ios14.0-simulator"

# 3. arm64 — Apple Silicon (M1/M2/M3) simulator
build_slice "arm64-simulator" \
  "ios" "arm64" \
  "arm64-apple-ios14.0-simulator"

# ============================================================
# Combine simulator slices with lipo (fat binary)
# ============================================================
echo "-----------------------------------------------------------"
echo "Creating fat simulator binary (x86_64 + arm64)..."

SIMULATOR_FAT="$BUILD_TMP/simulator-fat"
mkdir -p "$SIMULATOR_FAT"

lipo -create \
  "$BUILD_TMP/x86_64-simulator/libxray.a" \
  "$BUILD_TMP/arm64-simulator/libxray.a" \
  -output "$SIMULATOR_FAT/libxray.a"

# Copy header (they're identical across architectures for C exports)
cp "$BUILD_TMP/arm64-device/libxray.h" "$SIMULATOR_FAT/libxray.h"

echo " → $SIMULATOR_FAT/libxray.a (fat)"

# ============================================================
# Package as XCFramework
# ============================================================
echo "-----------------------------------------------------------"
echo "Packaging Xray.xcframework..."

# We need a module.modulemap for Swift to import the C symbols
DEVICE_DIR="$BUILD_TMP/arm64-device"
SIM_DIR="$SIMULATOR_FAT"

# Create module map for each slice


xcodebuild -create-xcframework \
  -library "$DEVICE_DIR/libxray.a" \
    -headers "$DEVICE_DIR" \
  -library "$SIM_DIR/libxray.a" \
    -headers "$SIM_DIR" \
  -output "$OUTPUT_XCFRAMEWORK"

# Cleanup
rm -rf "$BUILD_TMP"

echo "============================================================"
echo "SUCCESS: $OUTPUT_XCFRAMEWORK"
echo "============================================================"
