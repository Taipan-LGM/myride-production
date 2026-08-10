#!/usr/bin/env bash
# Driver Flutter → Path A Render staging (NOT legacy Node).
set -euo pipefail
cd "$(dirname "$0")/frontend"

STAGING_API="${API_BASE_URL:-https://my-ride-ecosystem.onrender.com}"
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
export API_BASE_URL="$STAGING_API"
if [[ -z "${WEBSOCKET_BASE_URL:-}" ]] || [[ "$WEBSOCKET_BASE_URL" == *"127.0.0.1"* ]] || [[ "$WEBSOCKET_BASE_URL" == *"localhost"* ]]; then
  WEBSOCKET_BASE_URL="${API_BASE_URL/https:/wss:}"
  WEBSOCKET_BASE_URL="${WEBSOCKET_BASE_URL/http:/ws:}"
fi
export WEBSOCKET_BASE_URL

# shellcheck disable=SC1091
source scripts/dart_defines.sh
DART_DEFINES+=(--dart-define="API_BASE_URL=${API_BASE_URL}")
DART_DEFINES+=(--dart-define="WEBSOCKET_BASE_URL=${WEBSOCKET_BASE_URL}")
DART_DEFINES+=(--dart-define="LEGACY_BACKEND=false")

echo "My Ride Driver (staging) → http://localhost:8767"
echo "API                      → ${API_BASE_URL}"
exec flutter run -t lib/main_driver.dart -d chrome --web-port=8767 "${DART_DEFINES[@]}"
