#!/usr/bin/env bash
# Ensure a booted Android emulator is running (kill stale qemu, launch if needed).
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/android_env.sh"

AVD_NAME="${ANDROID_AVD_NAME:-Pixel_7_API_34}"

_is_booted() {
  adb_use_device || return 1
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]
}

_kill_stale_emulator() {
  if ! pgrep -f "qemu-system.*${AVD_NAME}" >/dev/null 2>&1; then
    return 0
  fi
  if _is_booted; then
    return 0
  fi
  echo "Removing unresponsive emulator (no adb device)..."
  pkill -9 -f "qemu-system.*${AVD_NAME}" 2>/dev/null || true
  sleep 3
  adb kill-server >/dev/null 2>&1 || true
  adb start-server >/dev/null 2>&1 || true
}

if _is_booted; then
  echo "Emulator ready: $ADB_SERIAL"
  exit 0
fi

_kill_stale_emulator

if pgrep -f "qemu-system.*${AVD_NAME}" >/dev/null 2>&1; then
  echo "Emulator already starting — waiting for adb..."
  exit 0
fi

"$(dirname "$0")/launch_emulator.sh"
