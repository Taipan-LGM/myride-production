#!/usr/bin/env bash
# Sync GOOGLE_MAPS_API_KEY_IOS from frontend/.env → ios/Flutter/Secrets.xcconfig
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
SECRETS="$ROOT/ios/Flutter/Secrets.xcconfig"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy .env.example first."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

MAPS_KEY="${GOOGLE_MAPS_API_KEY_IOS:-${GOOGLE_MAPS_API_KEY:-}}"
if [ -z "$MAPS_KEY" ] || [ "$MAPS_KEY" = "YOUR_IOS_KEY" ] || [ "$MAPS_KEY" = "YOUR_ANDROID_KEY" ]; then
  echo "Set GOOGLE_MAPS_API_KEY_IOS in frontend/.env"
  exit 1
fi

echo "GOOGLE_MAPS_API_KEY=$MAPS_KEY" > "$SECRETS"
echo "Updated $SECRETS"
