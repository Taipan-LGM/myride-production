#!/usr/bin/env bash
# Run My Ride rider app on iOS simulator/device (macOS + Xcode required)
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

./scripts/sync_ios_env.sh 2>/dev/null || true

# shellcheck disable=SC1091
source scripts/dart_defines.sh

if [ -n "${GOOGLE_MAPS_API_KEY_IOS:-}" ] && [ "$GOOGLE_MAPS_API_KEY_IOS" != "YOUR_IOS_KEY" ]; then
  DART_DEFINES+=(--dart-define="GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY_IOS}")
  DART_DEFINES+=(--dart-define="GOOGLE_MAPS_API_KEY_IOS=${GOOGLE_MAPS_API_KEY_IOS}")
fi

echo "My Ride Rider (iOS)"
exec flutter run -t lib/main_rider.dart "${DART_DEFINES[@]}"
