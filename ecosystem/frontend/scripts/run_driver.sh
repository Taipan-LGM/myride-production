#!/usr/bin/env bash
# My Ride — Driver app (com.myride.driver)
set -euo pipefail
cd "$(dirname "$0")/.."

export API_BASE_URL="http://127.0.0.1:8001"

flutter pub get
flutter run --flavor driver -t lib/main_driver.dart \
  --dart-define=APP_FLAVOR=driver \
  --dart-define=API_BASE_URL="http://127.0.0.1:8001" \
  "$@"