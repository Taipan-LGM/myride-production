#!/usr/bin/env bash
# Tune Pixel AVD for smoother Linux emulator (reduces "Emulator not responding" ANRs).
set -euo pipefail

AVD_NAME="${ANDROID_AVD_NAME:-Pixel_7_API_34}"
AVD_INI="$HOME/.android/avd/${AVD_NAME}.avd/config.ini"

if [ ! -f "$AVD_INI" ]; then
  echo "❌ AVD config not found: $AVD_INI" >&2
  exit 1
fi

_set_kv() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$AVD_INI"; then
    sed -i "s/^${key}=.*/${key}=${val}/" "$AVD_INI"
  else
    echo "${key}=${val}" >>"$AVD_INI"
  fi
}

_set_kv "hw.ramSize" "2048"
_set_kv "vm.heapSize" "256"
_set_kv "hw.cpu.ncore" "2"
_set_kv "hw.gpu.enabled" "yes"
_set_kv "hw.gpu.mode" "swiftshader_indirect"
_set_kv "fastboot.forceColdBoot" "no"
_set_kv "fastboot.forceFastBoot" "yes"
_set_kv "PlayStore.enabled" "no"

echo "✅ Tuned $AVD_NAME for dev (2GB RAM, 2 cores, software GPU)."
