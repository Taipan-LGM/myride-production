#!/usr/bin/env bash
# Track 2: bring up Path A compose prod stack (api + postgres + redis).
# Requires Docker. Stop anything already on :8000 first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ECO="$ROOT/ecosystem"

if ! command -v docker >/dev/null 2>&1; then
  cat <<'EOF'
Docker not installed. In a terminal with sudo:

  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2
  sudo usermod -aG docker "$USER"
  newgrp docker   # or log out/in

Then re-run this script.
EOF
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon not reachable. Start it: sudo systemctl start docker"
  echo "Or join docker group: newgrp docker"
  exit 1
fi

ENVF="$ECO/backend/.env.prod"
if [[ ! -f "$ENVF" ]]; then
  echo "Missing $ENVF — copy from .env.prod.example and set JWT_SECRET + POSTGRES_PASSWORD"
  exit 1
fi
if grep -q 'replace-with' "$ENVF"; then
  echo "$ENVF still has replace-with placeholders — fill JWT_SECRET and POSTGRES_PASSWORD"
  exit 1
fi

if curl -sS -m 1 "http://127.0.0.1:8000/health" >/dev/null 2>&1; then
  echo "Port 8000 already answering /health. Stop local uvicorn (or change API_PORT) before compose."
  echo "  pkill -f 'ecosystem/backend.*run.py' || true"
  exit 1
fi

cd "$ECO"
make up-prod
echo "Waiting for health..."
for i in $(seq 1 40); do
  if curl -sS -m 2 "http://127.0.0.1:8000/health" | grep -q '"status"'; then
    curl -sS "http://127.0.0.1:8000/health"
    echo
    echo "OK — hub http://127.0.0.1:8000/"
    exit 0
  fi
  sleep 2
done
echo "Timed out waiting for /health. Check: cd ecosystem/backend && docker compose -f docker-compose.prod.yml logs"
exit 1
