#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${API_BASE_URL:=https://my-ride-ecosystem.onrender.com}"
flutter build appbundle --release --flavor driver -t lib/main_driver.dart \
  --dart-define=APP_FLAVOR=driver \
  --dart-define=API_BASE_URL="$API_BASE_URL" \
  --dart-define=LEGACY_BACKEND=false \
  "$@"
