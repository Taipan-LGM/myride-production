#!/usr/bin/env bash
# Section C — clients + go/no-go against Path A host.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${ECOSYSTEM_HOST:-https://my-ride-ecosystem.onrender.com}"
LOCAL="${LOCAL_API:-http://127.0.0.1:8000}"

echo "=== C1. Flutter staging scripts present ==="
test -x "$ROOT/ecosystem/run-rider-staging.sh"
test -x "$ROOT/ecosystem/run-driver-staging.sh"
grep -q 'LEGACY_BACKEND=false' "$ROOT/ecosystem/run-rider-staging.sh"
echo "ok scripts"

echo "=== C2. Rate-limit soak (hub must stay 200) ==="
# Hit authenticated-ish paths hard, then confirm hub/health still OK
for i in $(seq 1 80); do
  curl -sS -m 5 -o /dev/null "$LOCAL/docs" || true
done
h=$(curl -sS -m 5 -o /dev/null -w "%{http_code}" "$LOCAL/health")
hub=$(curl -sS -m 5 -o /dev/null -w "%{http_code}" "$LOCAL/")
echo "after_soak health=$h hub=$hub"
[[ "$h" == "200" && "$hub" == "200" ]] || { echo "FAIL: hub starved"; exit 1; }

echo "=== C3. Go/no-go API smoke (local) ==="
API_BASE="$LOCAL" "$ROOT/ecosystem/backend/scripts/smoke_test.sh" >/tmp/c-smoke-local.log
tail -3 /tmp/c-smoke-local.log

echo "=== C4. Go/no-go API smoke (Render Path A) ==="
set +e
API_BASE="$HOST" "$ROOT/ecosystem/backend/scripts/smoke_test.sh" >/tmp/c-smoke-render.log 2>&1
rc=$?
set -e
tail -8 /tmp/c-smoke-render.log
if [[ $rc -ne 0 ]]; then
  echo "WARN: full Render smoke exit=$rc — retry once"
  API_BASE="$HOST" "$ROOT/ecosystem/backend/scripts/smoke_test.sh" >/tmp/c-smoke-render.log 2>&1
  grep -q 'OK — production smoke passed' /tmp/c-smoke-render.log
else
  grep -q 'OK — production smoke passed' /tmp/c-smoke-render.log
fi
curl -sS -m 30 "$HOST/ops/cutover" | python3 -m json.tool | head -40

echo "=== C5. SOS 112 + refund cap unit tests ==="
cd "$ROOT/ecosystem/backend"
.venv/bin/pytest tests/ai/test_rider_services.py tests/ai/test_customer_service.py -q --tb=line

echo "=== C6. Flutter analyze (rider entry) ==="
export PATH="${HOME}/flutter/bin:$PATH"
cd "$ROOT/ecosystem/frontend"
flutter analyze lib/main_rider.dart lib/main_driver.dart lib/config/app_config.dart 2>&1 | tail -20

echo "SECTION C OK — Flutter staging runners + go/no-go smoke green"
echo "Launch UI: cd ecosystem && ./run-rider-staging.sh   # or ./run-rider.sh for local"
