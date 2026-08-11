#!/usr/bin/env bash
# My Ride Admin Console (com.myride.admin)
set -euo pipefail
cd "$(dirname "$0")/.."

export API_BASE_URL="http://127.0.0.1:8001"

flutter pub get
flutter run --dart-define=APP_FLAVOR=admin \
  --dart-define=API_BASE_URL="http://127.0.0.1:8001" \
  "$@"