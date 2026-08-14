#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${API_BASE_URL:=https://my-ride-ecosystem.onrender.com}"
flutter build appbundle --release --flavor rider -t lib/main_rider.dart \
  --dart-define=APP_FLAVOR=rider \
  --dart-define=API_BASE_URL="$API_BASE_URL" \
  --dart-define=LEGACY_BACKEND=false \
  "$@"
