#!/usr/bin/env bash
# Pre-grant driver permissions on emulator (avoids heavy system dialogs that freeze the emulator).
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/android_env.sh"

PKG="com.myride.my_ride"

if ! adb_use_device; then
  echo "❌ No Android device for permission grant." >&2
  exit 1
fi

echo "Tuning emulator performance on $ADB_SERIAL..."
adb shell settings put global window_animation_scale 0 >/dev/null 2>&1 || true
adb shell settings put global transition_animation_scale 0 >/dev/null 2>&1 || true
adb shell settings put global animator_duration_scale 0 >/dev/null 2>&1 || true

echo "Granting My Ride driver permissions..."
adb shell pm grant "$PKG" android.permission.ACCESS_FINE_LOCATION >/dev/null 2>&1 || true
adb shell pm grant "$PKG" android.permission.ACCESS_COARSE_LOCATION >/dev/null 2>&1 || true
adb shell pm grant "$PKG" android.permission.ACCESS_BACKGROUND_LOCATION >/dev/null 2>&1 || true
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true

# Mark setup complete in app prefs (matches driver_root_app key).
adb shell run-as "$PKG" sh -c '
  PREFS_DIR=$(ls -d /data/data/com.myride.my_ride/shared_prefs 2>/dev/null)
  if [ -n "$PREFS_DIR" ]; then
    cat > "$PREFS_DIR/FlutterSharedPreferences.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<map>
    <boolean name="flutter.driver_permissions_complete" value="true" />
</map>
EOF
  fi
' 2>/dev/null || true

echo "✅ Permissions granted on emulator (skip dialog taps if app still shows setup, tap through once)."
