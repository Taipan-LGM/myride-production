#!/usr/bin/env bash
# My Ride — Driver app (com.myride.driver)
set -euo pipefail
cd "$(dirname "$0")/.."

flutter pub get
flutter run -t lib/main_driver.dart \
  --dart-define=APP_FLAVOR=driver \
  "$@"
