#!/usr/bin/env bash
# My Ride — Rider app (com.myride.rider)
set -euo pipefail
cd "$(dirname "$0")/.."

flutter pub get
flutter run -t lib/main_rider.dart \
  --dart-define=APP_FLAVOR=rider \
  "$@"
