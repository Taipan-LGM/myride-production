#!/usr/bin/env bash
# Run My Ride rider app (Chrome web)
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

# Chrome on this machine always talks to the local API (not LAN IP from .env).
DART_DEFINES+=(--dart-define="API_BASE_URL=http://127.0.0.1:8000")
DART_DEFINES+=(--dart-define="WEBSOCKET_BASE_URL=ws://127.0.0.1:8000")

# Web build: prefer web maps key
if [ -n "${GOOGLE_MAPS_API_KEY_WEB:-}" ] && [ "$GOOGLE_MAPS_API_KEY_WEB" != "YOUR_WEB_KEY" ]; then
  DART_DEFINES+=(--dart-define="GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY_WEB}")
fi

echo "My Ride Rider → http://localhost:8766"
echo "API          → http://127.0.0.1:8000 (run ../run-api.sh in another terminal)"
echo "WebSocket    → ws://127.0.0.1:8000"
exec flutter run -t lib/main_rider.dart -d chrome --web-port=8766 "${DART_DEFINES[@]}"
