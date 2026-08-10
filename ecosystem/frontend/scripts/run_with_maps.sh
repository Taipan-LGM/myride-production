#!/usr/bin/env bash
# My Ride — with Google Maps (pass your API key)
set -euo pipefail
cd "$(dirname "$0")/.."

: "${GOOGLE_MAPS_API_KEY:?Set GOOGLE_MAPS_API_KEY}"

flutter run -t lib/main_rider.dart \
  --dart-define=GOOGLE_MAPS_API_KEY="$GOOGLE_MAPS_API_KEY" \
  "$@"
