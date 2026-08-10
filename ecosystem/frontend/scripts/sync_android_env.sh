#!/usr/bin/env bash
# Sync GOOGLE_MAPS_API_KEY from frontend/.env → android/local.properties
# Verify AndroidManifest location permissions for driver background tracking.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
LOCAL_PROPS="$ROOT/android/local.properties"
MANIFEST="$ROOT/android/app/src/main/AndroidManifest.xml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy .env.example first."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

MAPS_KEY="${GOOGLE_MAPS_API_KEY:-}"
MAPS_PLACEHOLDER=false
if [ -z "$MAPS_KEY" ] || [ "$MAPS_KEY" = "YOUR_ANDROID_KEY" ] || [[ "$MAPS_KEY" == YOUR_* ]]; then
  echo "⚠️  GOOGLE_MAPS_API_KEY not set in frontend/.env (still YOUR_ANDROID_KEY placeholder)."
  echo "   Web/Chrome dev works without Maps. Android device builds need a real key."
  MAPS_PLACEHOLDER=true
fi

# --- Location permission manifest checks (driver background tracking) ---
if [ ! -f "$MANIFEST" ]; then
  echo "⚠️  AndroidManifest.xml not found at $MANIFEST"
else
  _require_perm() {
    local perm="$1"
    if grep -q "$perm" "$MANIFEST"; then
      echo "✅ Manifest: $perm"
    else
      echo "⚠️  Missing in AndroidManifest.xml: $perm"
      echo "   Drivers need this for background location on Android 10+."
    fi
  }

  echo "Checking location permissions in AndroidManifest.xml..."
  _require_perm 'android.permission.ACCESS_FINE_LOCATION'
  _require_perm 'android.permission.ACCESS_BACKGROUND_LOCATION'
  _require_perm 'android.permission.FOREGROUND_SERVICE'
  _require_perm 'android.permission.FOREGROUND_SERVICE_LOCATION'
  _require_perm 'android.permission.POST_NOTIFICATIONS'

  if grep -q 'GeolocatorLocationService' "$MANIFEST"; then
    echo "✅ Manifest: GeolocatorLocationService"
  else
    echo "⚠️  Missing GeolocatorLocationService in <application> — background updates may fail."
  fi

  if ! grep -q 'ACCESS_BACKGROUND_LOCATION' "$MANIFEST"; then
    echo ""
    echo "⚠️  WARNING: ACCESS_BACKGROUND_LOCATION is not declared."
    echo "   Driver 'Allow all the time' will not work until you add it to AndroidManifest.xml."
  fi
fi

# Preserve flutter.sdk if local.properties exists
FLUTTER_SDK=""
if [ -f "$LOCAL_PROPS" ]; then
  FLUTTER_SDK="$(grep -E '^flutter\.sdk=' "$LOCAL_PROPS" | head -1 || true)"
fi
if [ -z "$FLUTTER_SDK" ] && command -v flutter >/dev/null 2>&1; then
  FLUTTER_SDK="flutter.sdk=$(dirname "$(dirname "$(command -v flutter)")")"
fi

{
  [ -n "$FLUTTER_SDK" ] && echo "$FLUTTER_SDK"
  if [ "$MAPS_PLACEHOLDER" = false ]; then
    echo "GOOGLE_MAPS_API_KEY=$MAPS_KEY"
  fi
} > "$LOCAL_PROPS"

if [ "$MAPS_PLACEHOLDER" = false ]; then
  echo "Updated $LOCAL_PROPS with GOOGLE_MAPS_API_KEY"
else
  echo "Skipped GOOGLE_MAPS_API_KEY in $LOCAL_PROPS (add a real key to .env for Android Maps)."
fi
