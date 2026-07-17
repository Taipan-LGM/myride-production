#!/usr/bin/env bash
# Start My Ride FastAPI backend (local dev)
set -euo pipefail
cd "$(dirname "$0")"

export PYTHONPATH="${PWD}:${PYTHONPATH:-}"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if command -v uv >/dev/null 2>&1; then
  if [ ! -d .venv ]; then
    uv venv .venv
  fi
  # shellcheck disable=SC1091
  source .venv/bin/activate
  uv pip install -q -r requirements.txt
elif [ ! -d .venv ]; then
  python3 -m venv .venv || {
    echo "Install python3-venv or uv, then re-run: ./start_api.sh"
    exit 1
  }
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install -q -r requirements.txt
else
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

API_PORT="${API_PORT:-8000}"

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
