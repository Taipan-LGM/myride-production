#!/usr/bin/env bash
# Resolve a Flutter Android device id (physical USB or emulator).
# Usage: source scripts/pick_android_device.sh  → sets ANDROID_DEVICE_ID
#        ./scripts/pick_android_device.sh       → prints device id
set -euo pipefail

_pick_android_device() {
  local json
  json="$(flutter devices --machine 2>/dev/null)" || {
    echo "❌ Could not list Flutter devices (is Flutter on PATH?)." >&2
    return 1
  }

  python3 -c "
import json, sys
devices = json.load(sys.stdin)
android = [d for d in devices if 'android' in d.get('targetPlatform', '').lower()]
if not android:
    sys.exit(1)
print(android[0]['id'])
" <<<"$json"
}

_print_android_setup_help() {
  cat >&2 <<'EOF'
❌ No Android device or emulator found.

This app must run on Android (not Linux/Chrome) for:
  • background location + "allow all the time"
  • foreground service notification when Online

Option A — physical phone (recommended):
  1. Phone: Settings → About → tap Build number 7× → Developer options
  2. Enable USB debugging
  3. Plug in USB; on phone tap "Allow" for this computer
  4. Verify: flutter devices   (should show your phone)

Option B — Android emulator:
  1. Install Android Studio → SDK Manager → install a system image (e.g. Pixel API 34)
  2. Device Manager → Create Virtual Device → start it
  3. Verify: flutter devices   (should show emulator-5554)

If the phone is plugged in but missing:
  sudo apt install adb
  adb devices
  # unauthorized → unlock phone and accept USB debugging prompt
EOF
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  _pick_android_device || { _print_android_setup_help; exit 1; }
else
  ANDROID_DEVICE_ID="$(_pick_android_device)" || {
    _print_android_setup_help
    exit 1
  }
  export ANDROID_DEVICE_ID
fi
