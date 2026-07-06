#!/usr/bin/env bash
#
# Build + sign + install the iOS example on a connected iPhone.
# Uses automatic signing under the developer team; VPN (Network Extension)
# requires a paid Apple Developer account and a real device (not simulator).
#
# Usage: scripts/ios-device.sh [--build-only]
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
[ "${1:-}" = "--build-only" ] && BUILD_ONLY=1

# Pick the first connected physical iPhone.
UDID="$(xcrun xctrace list devices 2>/dev/null \
  | awk -F'[()]' '/iPhone/ && !/Simulator/ {print $(NF-1)}' | head -1)"
if [ -z "$UDID" ]; then
  echo "No iPhone found. Connect + unlock + trust it, then retry." >&2
  xcrun xctrace list devices 2>/dev/null | grep -i iphone >&2 || true
  exit 1
fi
echo ">> Device UDID: $UDID"

echo ">> Building + signing (team $TEAM_ID)..."
xcodebuild build \
  -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Debug \
  -destination "id=$UDID" \
  -allowProvisioningUpdates -derivedDataPath "$DERIVED" \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM_ID" PROVISIONING_PROFILE_SPECIFIER=""

APP="$DERIVED/Build/Products/Debug-iphoneos/$SCHEME.app"
[ -d "$APP" ] || { echo "App not built at $APP" >&2; exit 1; }
echo ">> Built: $APP"

if [ "$BUILD_ONLY" = "1" ]; then
  echo "OK: build only (skipping install)."
  exit 0
fi

echo ">> Installing on $UDID..."
xcrun devicectl device install app --device "$UDID" "$APP"
echo "OK: installed. Trust the developer on-device (Settings → General → VPN & Device Management) on first run."
