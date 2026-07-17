#!/usr/bin/env bash
# Wait until an Android device/emulator is online.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/android_env.sh"

MAX_WAIT="${1:-120}"
RELAUNCH_AFTER="${2:-45}"

echo -n "Waiting for Android device"
deadline=$((SECONDS + MAX_WAIT))
relaunch_at=$((SECONDS + RELAUNCH_AFTER))
relauched=0

while (( SECONDS < deadline )); do
  if adb_use_device; then
    booted="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    if [ "$booted" = "1" ]; then
      echo " — ready ($ADB_SERIAL)."
      adb devices -l
      exit 0
    fi
    if [ "$((deadline - SECONDS))" -le 15 ]; then
      echo " — using $ADB_SERIAL (boot check skipped)."
      adb devices -l
      exit 0
    fi
  elif (( SECONDS >= relaunch_at && relauched == 0 )); then
  relauched=1
  echo ""
  echo "Still no adb device — retrying emulator launch..."
  "$(dirname "$0")/ensure_emulator.sh" || true
  relaunch_at=$((SECONDS + RELAUNCH_AFTER))
  fi
  echo -n "."
  sleep 2
done

echo ""
echo "❌ No Android device became ready within ${MAX_WAIT}s." >&2
echo "   Check: tail -50 /tmp/myride-emulator.log" >&2
echo "   Manual: flutter emulators --launch ${ANDROID_AVD_NAME:-Pixel_7_API_34}" >&2
adb devices -l >&2 || true
exit 1
