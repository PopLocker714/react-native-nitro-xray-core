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
  # -checklinkname=0: olcrtc pulls github.com/wlynxg/anet (via pion/webrtc),
  # which //go:linkname's net.zoneCache — rejected by Go 1.23+ without this.
  go build \
    -tags ios \
    -trimpath \
    -buildmode=c-archive \
    -ldflags="-s -w -checklinkname=0" \
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

# 2. arm64 — Apple Silicon simulator. x86_64 (Intel Mac) simulator is dropped:
#    it doubled the simulator archive to ~124MB (over GitHub's 100MB limit) and
#    Intel Macs are effectively gone. Modern Macs run the arm64 simulator.
build_slice "arm64-simulator" \
  "ios" "arm64" \
  "arm64-apple-ios14.0-simulator"

SIM_DIR="$BUILD_TMP/arm64-simulator"

# ============================================================
# Package as XCFramework
# ============================================================
echo "-----------------------------------------------------------"
echo "Packaging Xray.xcframework..."

DEVICE_DIR="$BUILD_TMP/arm64-device"

# Pass a headers dir containing ONLY the .h — if the .a is in the headers dir,
# xcframework-create copies it into Headers/ too, doubling the committed size.
DEV_HDR="$BUILD_TMP/dev-headers"; mkdir -p "$DEV_HDR"; cp "$DEVICE_DIR/libxray.h" "$DEV_HDR/"
SIM_HDR="$BUILD_TMP/sim-headers"; mkdir -p "$SIM_HDR"; cp "$SIM_DIR/libxray.h" "$SIM_HDR/"

xcodebuild -create-xcframework \
  -library "$DEVICE_DIR/libxray.a" \
    -headers "$DEV_HDR" \
  -library "$SIM_DIR/libxray.a" \
    -headers "$SIM_HDR" \
  -output "$OUTPUT_XCFRAMEWORK"

# Cleanup
rm -rf "$BUILD_TMP"

echo "============================================================"
echo "SUCCESS: $OUTPUT_XCFRAMEWORK"
echo "============================================================"
