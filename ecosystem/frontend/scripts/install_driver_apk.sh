#!/usr/bin/env bash
# Install pre-built driver APK onto a running/starting Android emulator.
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source scripts/android_env.sh

AVD_NAME="${ANDROID_AVD_NAME:-Pixel_7_API_34}"
APK_PATH="build/app/outputs/flutter-apk/app-debug.apk"

_build_apk() {
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
  # shellcheck disable=SC1091
  source scripts/dart_defines.sh
  DART_DEFINES+=(--dart-define="API_BASE_URL=http://10.0.2.2:8000")
  DART_DEFINES+=(--dart-define="WEBSOCKET_BASE_URL=ws://10.0.2.2:8000")
  DART_DEFINES+=(--dart-define="EMULATOR_DEV=true")
  ./scripts/ensure_android_ndk.sh
  echo "Building My Ride Driver APK (may take a few minutes)..."
  flutter build apk --debug -t lib/main_driver.dart "${DART_DEFINES[@]}"
}

if [ ! -f "$APK_PATH" ]; then
  if ! command -v flutter >/dev/null 2>&1; then
    echo "❌ APK not found and flutter is not on PATH." >&2
    exit 1
  fi
  _build_apk
fi

adb start-server >/dev/null 2>&1 || true
adb_sanitize_connections

./scripts/ensure_emulator.sh
./scripts/wait_for_android.sh 180
adb_use_device

echo "Using device: $ADB_SERIAL"
./scripts/grant_driver_permissions.sh

echo "Installing My Ride Driver..."
if ! adb install -r "$APK_PATH"; then
  echo "❌ Install failed — retrying after uninstall..." >&2
  adb uninstall com.myride.my_ride >/dev/null 2>&1 || true
  adb install "$APK_PATH"
fi
sleep 2

echo "Launching app..."
adb shell am start -n com.myride.my_ride/.MainActivity \
  || adb shell monkey -p com.myride.my_ride -c android.intent.category.LAUNCHER 1

echo ""
echo "✅ My Ride Driver is on the emulator."
echo "   API → http://10.0.2.2:8000   Demo OTP → 482901"
