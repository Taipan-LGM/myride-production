#!/usr/bin/env bash
# Shared Android + Flutter paths and adb helpers for My Ride scripts.
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$HOME/.gradle}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
if [ -d "$HOME/flutter/bin" ]; then
  PATH="$HOME/flutter/bin:$PATH"
fi
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

if command -v flutter >/dev/null 2>&1; then
  flutter config --android-sdk "$ANDROID_HOME" >/dev/null 2>&1 || true
fi

# Remove stale tcp adb entries (often show as offline and break multi-device adb).
adb_sanitize_connections() {
  adb start-server >/dev/null 2>&1 || true
  while read -r serial state _; do
  [ -z "${serial:-}" ] && continue
  if [[ "$serial" == 127.0.0.1:* && "$state" != "device" ]]; then
    adb disconnect "$serial" >/dev/null 2>&1 || true
  fi
  done < <(adb devices 2>/dev/null | awk 'NR>1 && NF {print $1, $2}')
}

# Pick first online device/emulator serial for adb -s.
adb_pick_device() {
  adb_sanitize_connections
  adb devices 2>/dev/null | awk 'NR>1 && $2=="device" { print $1; exit }'
}

adb_has_device() {
  [ -n "$(adb_pick_device)" ]
}

# Run adb against the selected device (sets ADB_SERIAL).
adb_use_device() {
  local serial
  serial="$(adb_pick_device)"
  if [ -z "$serial" ]; then
    return 1
  fi
  export ADB_SERIAL="$serial"
  export ANDROID_SERIAL="$serial"
  return 0
}
