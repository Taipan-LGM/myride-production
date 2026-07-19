#!/usr/bin/env bash
# Section A — production host prep (Render Path A + optional Compose).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ECO="$ROOT/ecosystem"

echo "=== A1. Production host (Path A) ==="
HOST="${ECOSYSTEM_HOST:-https://my-ride-ecosystem.onrender.com}"
code=$(curl -sS -m 40 -o /tmp/a-health.json -w "%{http_code}" "$HOST/health" || echo fail)
echo "health_http=$code $(head -c 160 /tmp/a-health.json 2>/dev/null || true)"
[[ "$code" == "200" ]] || { echo "FAIL: staging host not healthy"; exit 1; }

echo "=== A2. Hub ==="
hcode=$(curl -sS -m 30 -o /dev/null -w "%{http_code}" "$HOST/")
echo "hub_http=$hcode"
[[ "$hcode" == "200" ]] || exit 1

echo "=== A3. Emergency 112 ==="
curl -sS -m 20 "$HOST/safety/emergency" | tee /tmp/a-emergency.json | head -c 200
echo
grep -q '"112"' /tmp/a-emergency.json

echo "=== A4. Docker (optional Compose/VPS) ==="
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "docker_ok"
  if [[ -f "$ECO/backend/.env.prod" ]] && ! grep -q 'replace-with' "$ECO/backend/.env.prod"; then
    echo "Compose ready — run: $ROOT/scripts/up-prod-compose.sh"
  else
    echo "Fill $ECO/backend/.env.prod then: $ROOT/scripts/up-prod-compose.sh"
  fi
else
  cat <<'EOF'
docker_missing — Compose track deferred. Render is the production host.
To enable Compose later (one-time, needs your password):
  sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
  sudo usermod -aG docker "$USER" && newgrp docker
  "/home/taipan/Documents/My Ride/scripts/up-prod-compose.sh"
EOF
fi

echo "=== A5. Schema ==="
echo "init.sql auto-applies on API boot when DATABASE_URL is set (schema_migrate.py)."
test -f "$ECO/backend/database/init.sql"

echo "SECTION A OK — host=$HOST"
