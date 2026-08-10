#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/frontend"
exec ./run_driver.sh
