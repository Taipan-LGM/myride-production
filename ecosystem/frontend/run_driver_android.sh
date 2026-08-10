#!/usr/bin/env bash
# Run My Ride driver app on Android device/emulator (native permissions + foreground service)
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck disable=SC1091
source scripts/android_env.sh

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

./scripts/sync_android_env.sh 2>/dev/null || true

# shellcheck disable=SC1091
source scripts/dart_defines.sh

if [ -n "${GOOGLE_MAPS_API_KEY:-}" ] && [ "$GOOGLE_MAPS_API_KEY" != "YOUR_ANDROID_KEY" ]; then
  DART_DEFINES+=(--dart-define="GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY}")
fi

# Stale Linux CMake cache (e.g. after renaming flutter/ → frontend/)
if [ -f build/linux/x64/debug/CMakeCache.txt ] && grep -q 'ecosystem/flutter' build/linux/x64/debug/CMakeCache.txt 2>/dev/null; then
  echo "Clearing stale Linux build cache (old project path)..."
  rm -rf build/linux
fi

# shellcheck disable=SC1091
source scripts/pick_android_device.sh

# Android emulator reaches the host machine at 10.0.2.2 (not localhost / LAN IP).
if [[ "${ANDROID_DEVICE_ID}" == emulator-* ]]; then
  API_HOST_FOR_DEVICE="${ANDROID_EMULATOR_API_BASE_URL:-http://10.0.2.2:8000}"
  WS_HOST_FOR_DEVICE="${ANDROID_EMULATOR_WEBSOCKET_BASE_URL:-ws://10.0.2.2:8000}"
  DART_DEFINES+=(--dart-define="API_BASE_URL=${API_HOST_FOR_DEVICE}")
  DART_DEFINES+=(--dart-define="WEBSOCKET_BASE_URL=${WS_HOST_FOR_DEVICE}")
  echo "Emulator networking → API ${API_HOST_FOR_DEVICE}"
else
  echo "Physical device → API ${API_BASE_URL:-http://127.0.0.1:8000}"
fi

# Avoid corrupted Gradle caches in ephemeral environments.
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$HOME/.gradle}"

./scripts/ensure_android_ndk.sh

echo "My Ride Driver (Android) → device ${ANDROID_DEVICE_ID}"
if [[ "${ANDROID_DEVICE_ID}" == emulator-* ]]; then
  echo "API → ${API_HOST_FOR_DEVICE}"
else
  echo "API → ${API_BASE_URL:-http://127.0.0.1:8000}"
fi
echo ""
echo "First launch: allow location (while using) → allow all the time → notifications"
exec flutter run -t lib/main_driver.dart -d "${ANDROID_DEVICE_ID}" "${DART_DEFINES[@]}"
