#!/usr/bin/env bash
# One-time Android dev setup for My Ride (Zorin/Ubuntu).
# Installs JDK + Android SDK + emulator, then wires Flutter to it.
#
# Usage:
#   cd "/home/taipan/Documents/My Ride/ecosystem"
#   ./scripts/setup-android-dev.sh
#
# After setup:
#   flutter emulators --launch Pixel_7_API_34
#   cd frontend && ./run_driver_android.sh
set -euo pipefail

SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
CMDLINE_ZIP_VER="11076708"
AVD_NAME="Pixel_7_API_34"
SYSTEM_IMAGE="system-images;android-34;google_apis_playstore;x86_64"
PLATFORM_API="36"

echo "=== My Ride — Android dev setup ==="
echo "SDK target: $SDK_ROOT"
echo ""

need_sudo=false
for pkg in openjdk-17-jdk unzip curl qemu-kvm; do
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    need_sudo=true
    break
  fi
done

if $need_sudo; then
  echo "Installing system packages (sudo required)..."
  sudo apt update
  sudo apt install -y openjdk-17-jdk unzip curl qemu-kvm adb
  sudo usermod -aG kvm,plugdev "$USER" 2>/dev/null || true
  echo ""
  echo "Note: log out and back in (or reboot) so kvm/plugdev group membership applies."
  echo ""
fi

mkdir -p "$SDK_ROOT/cmdline-tools"

if [ ! -x "$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "Downloading Android command-line tools..."
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL \
    "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_ZIP_VER}_latest.zip" \
    -o "$tmp/cmdline-tools.zip"
  unzip -q "$tmp/cmdline-tools.zip" -d "$tmp"
  rm -rf "$SDK_ROOT/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$SDK_ROOT/cmdline-tools/latest"
  echo "Command-line tools installed."
fi

export ANDROID_HOME="$SDK_ROOT"
export ANDROID_SDK_ROOT="$SDK_ROOT"
export PATH="$SDK_ROOT/cmdline-tools/latest/bin:$SDK_ROOT/platform-tools:$SDK_ROOT/emulator:$PATH"

# Persist for future shells
grep -q 'ANDROID_HOME=' "$HOME/.bashrc" 2>/dev/null || {
  cat >>"$HOME/.bashrc" <<EOF

# Android SDK (My Ride setup)
export ANDROID_HOME="$SDK_ROOT"
export ANDROID_SDK_ROOT="$SDK_ROOT"
export PATH="\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/emulator:\$PATH"
EOF
  echo "Appended ANDROID_HOME to ~/.bashrc"
}

echo "Installing SDK packages (may take several minutes)..."
yes | sdkmanager --licenses >/dev/null
sdkmanager \
  "platform-tools" \
  "platforms;android-${PLATFORM_API}" \
  "build-tools;36.0.0" \
  "emulator" \
  "$SYSTEM_IMAGE"

flutter config --android-sdk "$SDK_ROOT"
yes | flutter doctor --android-licenses >/dev/null 2>&1 || true

if [ ! -d "$HOME/.android/avd/${AVD_NAME}.avd" ]; then
  echo "Creating emulator: $AVD_NAME"
  echo no | avdmanager create avd \
    -n "$AVD_NAME" \
    -k "$SYSTEM_IMAGE" \
    -d pixel_7
fi

echo ""
echo "=== Setup complete ==="
flutter doctor -v | sed -n '/Android toolchain/,/^$/p' || true
echo ""
echo "Start emulator:"
echo "  flutter emulators --launch $AVD_NAME"
echo ""
echo "Or plug in a phone (USB debugging on), then:"
echo "  adb devices"
echo "  flutter devices"
echo ""
echo "Run driver app:"
echo "  cd \"$(cd "$(dirname "$0")/.." && pwd)/frontend\""
echo "  ./run_driver_android.sh"
