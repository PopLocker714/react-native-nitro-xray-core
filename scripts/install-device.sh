#!/usr/bin/env bash
#
# Build a STANDALONE release APK of the example app and install it on a real
# Android phone. The release build embeds the JS bundle and is signed with the
# debug keystore (see example/android/app/build.gradle), so it:
#   • installs without the Play Store, and
#   • runs WITHOUT a Metro dev server — usable on mobile data, untethered.
#
# Usage:
#   scripts/install-device.sh                 # auto-pick the connected phone
#   scripts/install-device.sh --device <id>   # target a specific adb serial
#   scripts/install-device.sh --native        # also rebuild libxray.so first
#
# Requirements: a phone with USB debugging + "install via USB" enabled, adb,
# and the Android SDK/NDK (same as `bun run android`).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$REPO_ROOT/example/android"
APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
PKG="com.nitroxraycoreexample"

DEVICE=""
BUILD_NATIVE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --device) DEVICE="${2:-}"; shift 2 ;;
    --native) BUILD_NATIVE=1; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Auto-pick a physical device (skip emulators) when none was given.
if [ -z "$DEVICE" ]; then
  DEVICE="$(adb devices | awk 'NR>1 && $2=="device" && $1 !~ /^emulator-/ {print $1; exit}')"
fi
if [ -z "$DEVICE" ]; then
  echo "No physical device found. Connect a phone with USB debugging enabled." >&2
  adb devices >&2
  exit 1
fi
echo "▶ Target device: $DEVICE"

if [ "$BUILD_NATIVE" = "1" ]; then
  echo "▶ Rebuilding merged native libxray.so (xray + olcrtc)…"
  ( cd "$REPO_ROOT/go-core" && bash build_android.sh )
fi

echo "▶ Building release APK (JS bundle embedded)…"
( cd "$ANDROID_DIR" && ./gradlew assembleRelease )

if [ ! -f "$APK" ]; then
  echo "APK not found at $APK — build failed?" >&2
  exit 1
fi

echo "▶ Installing on $DEVICE…"
adb -s "$DEVICE" install -r "$APK"

echo "▶ Launching…"
adb -s "$DEVICE" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true

echo
echo "✅ Installed and launched on $DEVICE."
echo "   APK: $APK"
echo "   Sideload elsewhere: adb install -r \"$APK\"  (or copy the APK to the phone)"
