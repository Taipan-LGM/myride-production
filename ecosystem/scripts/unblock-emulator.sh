#!/usr/bin/env bash
# My Ride — Android emulator unblock (cold boot + clear locks)
set -euo pipefail

echo "MY RIDE EMULATOR UNBLOCK"

pkill -9 emulator 2>/dev/null || true
pkill -9 qemu-system 2>/dev/null || true
adb kill-server 2>/dev/null || true

rm -f "${HOME}/.android/avd/"*.lock 2>/dev/null || true
rm -f "${HOME}/.android/"*.lock 2>/dev/null || true

AVD_NAME="${1:-MyRideAVD}"
if ! command -v emulator >/dev/null 2>&1; then
  echo "emulator not on PATH — install Android SDK / set ANDROID_HOME"
  exit 1
fi

echo "Cold-booting AVD: ${AVD_NAME}"
emulator -avd "${AVD_NAME}" \
  -wipe-data \
  -no-snapshot-load \
  -no-snapshot-save \
  -memory 4096 \
  -partition-size 4096 \
  -gpu swiftshader_indirect \
  -noaudio \
  >/tmp/myride-emulator.log 2>&1 &

echo "Waiting for device…"
adb wait-for-device
adb shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done' || true
echo "Emulator ready. Log: /tmp/myride-emulator.log"
echo "Next: cd frontend && flutter run -t lib/main_rider.dart"
