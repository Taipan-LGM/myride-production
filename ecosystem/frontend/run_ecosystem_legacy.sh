#!/usr/bin/env bash
# Full My Ride ecosystem (Rider + Driver + Admin hub) against legacy Node :3000
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

DART_DEFINES+=(--dart-define="LEGACY_BACKEND=true")
DART_DEFINES+=(--dart-define="API_BASE_URL=http://127.0.0.1:3000")
DART_DEFINES+=(--dart-define="SOCKET_BASE_URL=http://127.0.0.1:3000")

if [ -n "${GOOGLE_MAPS_API_KEY_WEB:-}" ] && [ "$GOOGLE_MAPS_API_KEY_WEB" != "YOUR_WEB_KEY" ]; then
  DART_DEFINES+=(--dart-define="GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY_WEB}")
fi

echo "My Ride Ecosystem (legacy) → http://localhost:8765"
echo "  Landing: Rider / Driver / Admin sign-in + Open Demo Ecosystem"
echo "Node API + Socket.io      → http://127.0.0.1:3000"
exec flutter run -t lib/main.dart -d chrome --web-port=8765 "${DART_DEFINES[@]}"
