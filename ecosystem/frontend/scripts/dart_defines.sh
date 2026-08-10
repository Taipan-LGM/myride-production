#!/usr/bin/env bash
# Build flutter --dart-define args from .env (source this file after loading .env)
# Must be sourced from bash (uses arrays). Parent scripts: run_rider.sh, run_driver.sh, etc.
# Usage: source scripts/dart_defines.sh && flutter run ... "${DART_DEFINES[@]}"

DART_DEFINES=()

# Skip placeholder / unset values — never pass YOUR_* or pk_test_... to --dart-define.
_is_placeholder() {
  local val="$1"
  [ -z "$val" ] && return 0
  case "$val" in
    REPLACE_ME|YOUR_ANDROID_KEY|YOUR_IOS_KEY|YOUR_WEB_KEY) return 0 ;;
  esac
  [ "$val" = "..." ] && return 0
  [[ "$val" == YOUR_* ]] && return 0
  [[ "$val" == pk_test_* ]] && return 0
  return 1
}

_add_define() {
  local key="$1"
  local val="${2:-}"
  _is_placeholder "$val" && return
  DART_DEFINES+=(--dart-define="${key}=${val}")
}

API="${API_BASE_URL:-http://127.0.0.1:8000}"
WS="${WEBSOCKET_BASE_URL:-}"

_add_define "API_BASE_URL" "$API"
[ -n "$WS" ] && _add_define "WEBSOCKET_BASE_URL" "$WS"

# Maps — platform-specific keys + fallback for current platform in run script
_add_define "GOOGLE_MAPS_API_KEY" "${GOOGLE_MAPS_API_KEY:-}"
_add_define "GOOGLE_MAPS_API_KEY_IOS" "${GOOGLE_MAPS_API_KEY_IOS:-}"
_add_define "GOOGLE_MAPS_API_KEY_WEB" "${GOOGLE_MAPS_API_KEY_WEB:-}"

_add_define "STRIPE_PUBLISHABLE_KEY" "${STRIPE_PUBLISHABLE_KEY:-}"

# Firebase — enable when project id looks configured
FB="${FIREBASE_ENABLED:-}"
if [ -z "$FB" ] && [ -n "${FIREBASE_PROJECT_ID:-}" ]; then
  if _is_placeholder "${FIREBASE_PROJECT_ID}"; then
    FB=false
  else
    FB=true
  fi
fi
FB="${FB:-false}"
_add_define "FIREBASE_ENABLED" "$FB"

_add_define "FIREBASE_WEB_API_KEY" "${FIREBASE_WEB_API_KEY:-}"
_add_define "FIREBASE_AUTH_DOMAIN" "${FIREBASE_AUTH_DOMAIN:-}"
_add_define "FIREBASE_PROJECT_ID" "${FIREBASE_PROJECT_ID:-}"
_add_define "FIREBASE_STORAGE_BUCKET" "${FIREBASE_STORAGE_BUCKET:-}"
_add_define "FIREBASE_MESSAGING_SENDER_ID" "${FIREBASE_MESSAGING_SENDER_ID:-}"
_add_define "FIREBASE_APP_ID" "${FIREBASE_APP_ID:-}"

# Android/iOS Firebase (optional — for mobile builds)
  _add_define "FIREBASE_ANDROID_API_KEY" "${FIREBASE_ANDROID_API_KEY:-$GOOGLE_MAPS_API_KEY}"
  _add_define "FIREBASE_IOS_API_KEY" "${FIREBASE_IOS_API_KEY:-$GOOGLE_MAPS_API_KEY_IOS}"

# Emulator builds (set EMULATOR_DEV=true in env or pass via script)
_add_define "EMULATOR_DEV" "${EMULATOR_DEV:-false}"
