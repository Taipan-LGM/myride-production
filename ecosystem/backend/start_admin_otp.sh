#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — add your SMTP_PASSWORD, then re-run."
  exit 1
fi

# shellcheck disable=SC1091
source .env

if [[ -z "${SMTP_PASSWORD:-}" && -z "${RESEND_API_KEY:-}" ]]; then
  echo "No SMTP_PASSWORD or RESEND_API_KEY set."
  echo "DEV_OTP_CONSOLE=true will print codes in this terminal."
fi

echo "Starting OTP server on http://127.0.0.1:${OTP_PORT:-8788}"
python3 admin_otp_server.py
