#!/usr/bin/env bash
# Ensure Flutter's required NDK is installed (first Android build downloads ~700MB).
set -euo pipefail

NDK_VERSION="${FLUTTER_NDK_VERSION:-28.2.13676358}"
SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
NDK_DIR="$SDK_ROOT/ndk/$NDK_VERSION"
ZIP_URL="https://dl.google.com/android/repository/android-ndk-r28c-linux.zip"
TMP_ZIP="${TMPDIR:-/tmp}/android-ndk-r28c-linux.zip"
SHA1_EXPECTED="a7b54a5de87fecd125a17d54f73c446199e72a64"

if [ -x "$NDK_DIR/toolchains/llvm/prebuilt/linux-x86_64/bin/clang" ]; then
  exit 0
fi

echo "Installing Android NDK $NDK_VERSION (one-time, ~689 MB)..."

mkdir -p "$SDK_ROOT/ndk"
rm -rf "$NDK_DIR"

if [ ! -f "$TMP_ZIP" ] || ! sha1sum -c <<<"${SHA1_EXPECTED}  ${TMP_ZIP}" >/dev/null 2>&1; then
  echo "Downloading NDK..."
  curl -fL --retry 5 --retry-delay 5 -C - -o "$TMP_ZIP" "$ZIP_URL"
  echo "${SHA1_EXPECTED}  ${TMP_ZIP}" | sha1sum -c -
fi

echo "Extracting NDK..."
unzip -q "$TMP_ZIP" -d "$SDK_ROOT/ndk"
mv "$SDK_ROOT/ndk/android-ndk-r28c" "$NDK_DIR"

if [ -x "$NDK_DIR/toolchains/llvm/prebuilt/linux-x86_64/bin/clang" ]; then
  echo "✅ NDK ready at $NDK_DIR"
else
  echo "❌ NDK install failed — expected clang in $NDK_DIR" >&2
  exit 1
fi
