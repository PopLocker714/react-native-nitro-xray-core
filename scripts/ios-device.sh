#!/usr/bin/env bash
#
# Build + sign + install the iOS example on a connected iPhone.
# Uses automatic signing under the developer team; VPN (Network Extension)
# requires a paid Apple Developer account and a real device (not simulator).
#
# Usage: scripts/ios-device.sh [--build-only] [--debug]
#
# Defaults to a RELEASE build: the JS bundle is embedded, so the app runs
# standalone with no Metro dev server (untethered, mobile data) — and can't hit
# a stray Metro from another project (RN version mismatch). Pass --debug to build
# Debug (requires this repo's Metro running).
#
# Requires: the Apple ID for TEAM_ID logged into Xcode (Settings → Accounts),
# the iPhone connected/unlocked/trusted.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE="$REPO_ROOT/example/ios/NitroXrayCoreExample.xcworkspace"
SCHEME="NitroXrayCoreExample"
TEAM_ID="4548L5D8WL"
DERIVED="/tmp/nitroxray_dd"

BUILD_ONLY=0
CONFIG="Release"
for arg in "$@"; do
  case "$arg" in
    --build-only) BUILD_ONLY=1 ;;
    --debug) CONFIG="Debug" ;;
  esac
done

# Pick the first connected physical iPhone.
UDID="$(xcrun xctrace list devices 2>/dev/null \
  | awk -F'[()]' '/iPhone/ && !/Simulator/ {print $(NF-1)}' | head -1)"
if [ -z "$UDID" ]; then
  echo "No iPhone found. Connect + unlock + trust it, then retry." >&2
  xcrun xctrace list devices 2>/dev/null | grep -i iphone >&2 || true
  exit 1
fi
echo ">> Device UDID: $UDID"

echo ">> Building + signing (team $TEAM_ID, $CONFIG)..."
# STRIP_INSTALLED_PRODUCT/COPY_PHASE_STRIP=NO: Apple's `strip` can't process the
# Go static archive (libxray.a) in Release ("string table not at the end") — skip
# stripping it.
xcodebuild build \
  -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration "$CONFIG" \
  -destination "id=$UDID" \
  -allowProvisioningUpdates -derivedDataPath "$DERIVED" \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM_ID" PROVISIONING_PROFILE_SPECIFIER="" \
  STRIP_INSTALLED_PRODUCT=NO COPY_PHASE_STRIP=NO

APP="$DERIVED/Build/Products/$CONFIG-iphoneos/$SCHEME.app"
[ -d "$APP" ] || { echo "App not built at $APP" >&2; exit 1; }
echo ">> Built: $APP"

if [ "$BUILD_ONLY" = "1" ]; then
  echo "OK: build only (skipping install)."
  exit 0
fi

echo ">> Installing on $UDID..."
xcrun devicectl device install app --device "$UDID" "$APP"
echo "OK: installed. Trust the developer on-device (Settings → General → VPN & Device Management) on first run."
