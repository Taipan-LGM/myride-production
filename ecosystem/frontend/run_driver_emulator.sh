#!/usr/bin/env bash
# Start Android emulator (if needed), build driver APK, install and open on device.
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck disable=SC1091
source scripts/android_env.sh

if ! command -v flutter >/dev/null 2>&1; then
  echo "❌ flutter not found. Add ~/flutter/bin to PATH." >&2
  exit 1
fi

AVD_NAME="${ANDROID_AVD_NAME:-Pixel_7_API_34}"
AVD_DIR="$HOME/.android/avd/${AVD_NAME}.avd"
APK_PATH="build/app/outputs/flutter-apk/app-debug.apk"

if [ ! -d "$AVD_DIR" ]; then
  echo "❌ Emulator '$AVD_NAME' not found. Run: cd .. && ./scripts/setup-android-dev.sh" >&2
  exit 1
fi

adb start-server >/dev/null 2>&1 || true
adb_sanitize_connections

# Start emulator BEFORE the slow Gradle build so it can boot in parallel.
./scripts/ensure_emulator.sh

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

need_build=0
if [ ! -f "$APK_PATH" ] || [ "${FORCE_REBUILD:-}" = "1" ]; then
  need_build=1
fi

if [ "$need_build" = "1" ]; then
  echo ""
  echo "Building My Ride Driver APK (emulator booting in parallel)..."
  flutter build apk --debug -t lib/main_driver.dart "${DART_DEFINES[@]}" &
  build_pid=$!
  ./scripts/wait_for_android.sh 300 &
  wait_pid=$!
  wait "$build_pid"
  wait "$wait_pid"
else
  echo ""
  echo "Using existing APK ($(du -h "$APK_PATH" | cut -f1)) — delete it or FORCE_REBUILD=1 to rebuild."
  ./scripts/wait_for_android.sh 180
fi

adb_use_device

./scripts/grant_driver_permissions.sh

echo ""
echo "Installing and launching on $ADB_SERIAL..."
adb install -r "$APK_PATH"
sleep 2
adb shell am start -n com.myride.my_ride/.MainActivity \
  || adb shell monkey -p com.myride.my_ride -c android.intent.category.LAUNCHER 1

echo ""
echo "✅ My Ride Driver should now be open on the emulator."
echo "   API → http://10.0.2.2:8000 (run ./run-api.sh on the host)"
echo "   Demo OTP → 482901"
