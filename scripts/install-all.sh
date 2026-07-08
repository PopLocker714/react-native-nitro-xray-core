#!/usr/bin/env bash
#
# Install the example app on every connected device — Android (physical or
# emulator) AND a connected iPhone — in one go. Skips a platform gracefully when
# nothing is attached.
#
# Usage:
#   scripts/install-all.sh            # both platforms, whatever is connected
#   scripts/install-all.sh --android  # Android only
#   scripts/install-all.sh --ios      # iOS only

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

WANT_ANDROID=1
WANT_IOS=1
for arg in "$@"; do
  case "$arg" in
    --android) WANT_IOS=0 ;;
    --ios) WANT_ANDROID=0 ;;
  esac
done

did=0
failed=0

if [ "$WANT_ANDROID" = "1" ]; then
  phys="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" && $1 !~ /^emulator-/ {print $1; exit}')"
  emu="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" && $1 ~ /^emulator-/ {print $1; exit}')"
  target="${phys:-$emu}"
  if [ -n "$target" ]; then
    echo "==> Android: installing on $target"
    if bash "$REPO_ROOT/scripts/install-device.sh" --device "$target"; then did=1; else failed=1; fi
  else
    echo "--- Android: no device/emulator connected, skipping"
  fi
fi

if [ "$WANT_IOS" = "1" ]; then
  ios="$(xcrun xctrace list devices 2>/dev/null | awk -F'[()]' '/iPhone/ && !/Simulator/ {print $(NF-1); exit}')"
  if [ -n "$ios" ]; then
    echo "==> iOS: installing on $ios"
    if bash "$REPO_ROOT/scripts/ios-device.sh"; then did=1; else failed=1; fi
  else
    echo "--- iOS: no iPhone connected, skipping"
  fi
fi

echo
if [ "$failed" = "1" ]; then
  echo "One or more installs failed." >&2
  exit 1
elif [ "$did" = "1" ]; then
  echo "OK: installed on all connected devices."
else
  echo "No devices found (Android or iOS)." >&2
  exit 1
fi
