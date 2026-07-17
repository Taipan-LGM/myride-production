#!/usr/bin/env bash
# Run My Ride rider app on Android device/emulator
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

./scripts/sync_android_env.sh 2>/dev/null || true

# shellcheck disable=SC1091
source scripts/dart_defines.sh

# Android: use GOOGLE_MAPS_API_KEY from .env
if [ -n "${GOOGLE_MAPS_API_KEY:-}" ] && [ "$GOOGLE_MAPS_API_KEY" != "YOUR_ANDROID_KEY" ]; then
  DART_DEFINES+=(--dart-define="GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY}")
fi

# shellcheck disable=SC1091
source scripts/pick_android_device.sh

echo "My Ride Rider (Android) → device ${ANDROID_DEVICE_ID}"
exec flutter run -t lib/main_rider.dart -d "${ANDROID_DEVICE_ID}" "${DART_DEFINES[@]}"
