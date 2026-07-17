#!/usr/bin/env bash
# Install pre-built My Ride driver APK on the emulator (fast — no rebuild).
set -euo pipefail
cd "$(dirname "$0")/frontend"
exec ./scripts/install_driver_apk.sh
