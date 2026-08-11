#!/usr/bin/env bash
# Start My Ride FastAPI backend (local dev)
set -euo pipefail
cd "$(dirname "$0")"

# Unset PYTHONPATH to prevent Hermes venv shadowing project venv
# Also set PYTHONHOME to ensure we use the correct standard library
export PYTHONPATH="${PWD}"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

# Check if venv exists and has Scripts directory (Windows) or bin directory (Unix)
if [ -d ".venv/Scripts" ]; then
  # Windows venv
  source .venv/Scripts/activate
elif [ -d ".venv/bin" ]; then
  # Unix venv
  source .venv/bin/activate
else
  # Try to create venv if it doesn't exist
  if command -v uv >/dev/null 2>&1; then
    uv venv .venv
  fi
  if [ -d ".venv/Scripts" ]; then
    source .venv/Scripts/activate
  elif [ -d ".venv/bin" ]; then
    source .venv/bin/activate
  else
    echo "Could not find venv Scripts or bin directory"
    exit 1
  fi
fi

set -a
source .env
set +a

API_PORT="${API_PORT:-8001}"

if command -v ss >/dev/null 2>&1 && ss -tln 2>/dev/null | grep -qE ":${API_PORT}\b"; then
  if curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
    echo "✅ My Ride API is already running on port ${API_PORT}"
    echo "   Health → http://127.0.0.1:${API_PORT}/health"
    echo "   Docs   → http://127.0.0.1:${API_PORT}/docs"
    echo ""
    echo "To restart: kill \$(lsof -t -i:${API_PORT})  then ./run-api.sh"
    exit 0
  fi
  echo "❌ Port ${API_PORT} is already in use (not My Ride API)."
  echo "   Free it: kill \$(lsof -t -i:${API_PORT})"
  lsof -i ":${API_PORT}" 2>/dev/null || true
  exit 1
fi

echo "My Ride API → http://${API_HOST:-0.0.0.0}:${API_PORT}"
echo "Docs        → http://127.0.0.1:${API_PORT}/docs"
exec python run.py