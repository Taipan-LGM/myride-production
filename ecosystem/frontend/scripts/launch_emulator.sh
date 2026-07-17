#!/usr/bin/env bash
# Launch Android emulator with settings that reduce ANRs on Linux (Intel iGPU).
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/android_env.sh"

AVD_NAME="${ANDROID_AVD_NAME:-Pixel_7_API_34}"

"$(dirname "$0")/tune_emulator_avd.sh"

if adb_has_device; then
  booted="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  if [ "$booted" = "1" ]; then
    echo "Android device already connected ($(adb_pick_device))."
    exit 0
  fi
fi

if pgrep -f "qemu-system.*${AVD_NAME}" >/dev/null 2>&1; then
  echo "Emulator already starting — waiting for adb..."
  exit 0
fi

ACCEL_ARGS=(-accel on)
if [ ! -r /dev/kvm ] || ! id -nG "$USER" 2>/dev/null | tr ' ' '\n' | grep -qx kvm; then
  echo "⚠ KVM unavailable — using software CPU emulation (slower, more stable)."
  ACCEL_ARGS=(-accel off)
fi

echo "Starting $AVD_NAME (software GPU, 2GB RAM, 2 cores, no boot anim)..."
nohup "$ANDROID_HOME/emulator/emulator" \
  -avd "$AVD_NAME" \
  -gpu swiftshader_indirect \
  -memory 2048 \
  -cores 2 \
  -no-boot-anim \
  -no-audio \
  "${ACCEL_ARGS[@]}" \
  >/tmp/myride-emulator.log 2>&1 &

echo "  logs → /tmp/myride-emulator.log"
echo "  tip: if this fails, open the emulator manually: flutter emulators --launch $AVD_NAME"
