#!/usr/bin/env bash
# Rider Flutter → Path A Render staging (NOT legacy Node).
set -euo pipefail
cd "$(dirname "$0")/frontend"

STAGING_API="${API_BASE_URL:-https://my-ride-ecosystem.onrender.com}"
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
# Always prefer staging host for this script (ignore .env local API)
export API_BASE_URL="$STAGING_API"
if [[ -z "${WEBSOCKET_BASE_URL:-}" ]] || [[ "$WEBSOCKET_BASE_URL" == *"127.0.0.1"* ]] || [[ "$WEBSOCKET_BASE_URL" == *"localhost"* ]]; then
  WEBSOCKET_BASE_URL="${API_BASE_URL/https:/wss:}"
  WEBSOCKET_BASE_URL="${WEBSOCKET_BASE_URL/http:/ws:}"
fi
export WEBSOCKET_BASE_URL

# shellcheck disable=SC1091
source scripts/dart_defines.sh

# Force staging hosts (override dart_defines local defaults)
DART_DEFINES+=(--dart-define="API_BASE_URL=${API_BASE_URL}")
DART_DEFINES+=(--dart-define="WEBSOCKET_BASE_URL=${WEBSOCKET_BASE_URL}")

if [ -n "${GOOGLE_MAPS_API_KEY_WEB:-}" ] && [ "$GOOGLE_MAPS_API_KEY_WEB" != "YOUR_WEB_KEY" ]; then
  DART_DEFINES+=(--dart-define="GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY_WEB}")
fi

echo "My Ride Rider (staging) → http://localhost:8766"
echo "API                     → ${API_BASE_URL}"
echo "WebSocket               → ${WEBSOCKET_BASE_URL}"
exec flutter run -t lib/main_rider.dart -d chrome --web-port=8766 "${DART_DEFINES[@]}"
