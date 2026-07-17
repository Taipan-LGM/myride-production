#!/usr/bin/env bash
# Run My Ride driver app (Chrome web)
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# shellcheck disable=SC1091
source scripts/dart_defines.sh

if [ -n "${GOOGLE_MAPS_API_KEY_WEB:-}" ] && [ "$GOOGLE_MAPS_API_KEY_WEB" != "YOUR_WEB_KEY" ]; then
  DART_DEFINES+=(--dart-define="GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY_WEB}")
fi

echo "My Ride Driver → http://localhost:8767 (Chrome — UI dev only)"
echo "API           → ${API_BASE_URL:-http://127.0.0.1:8000}"
echo "WebSocket     → ${WEBSOCKET_BASE_URL:-<derived from API_BASE_URL>}"
echo ""
echo "For Android permissions + foreground service, use: ./run_driver_android.sh"
if [ -z "${GOOGLE_MAPS_API_KEY_WEB:-}" ] || [ "$GOOGLE_MAPS_API_KEY_WEB" = "YOUR_WEB_KEY" ]; then
  echo "Maps          → mock/offline tiles (set GOOGLE_MAPS_API_KEY_WEB in .env for real maps)"
fi
exec flutter run -t lib/main_driver.dart -d chrome --web-port=8767 "${DART_DEFINES[@]}"
