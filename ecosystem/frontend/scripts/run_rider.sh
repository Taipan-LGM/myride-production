#!/usr/bin/env bash
# My Ride — Rider app (com.myride.rider)
set -euo pipefail
cd "$(dirname "$0")/.."

export API_BASE_URL="http://127.0.0.1:8001"

flutter pub get
flutter run --flavor rider -t lib/main_rider.dart \
  --dart-define=APP_FLAVOR=rider \
  --dart-define=API_BASE_URL="http://127.0.0.1:8001" \
  "$@"