#!/usr/bin/env bash
# Smoke: legacy Render — health + customer register/login + cash-path ride + mock-pay (if allowed)
# Usage:
#   BASE_URL=https://my-ride.onrender.com ./scripts/smoke-legacy-render.sh
set -euo pipefail

BASE_URL="${BASE_URL:-https://my-ride.onrender.com}"
BASE_URL="${BASE_URL%/}"
EMAIL="${SMOKE_EMAIL:-smoke.$(date +%s)@myride.local}"
PASS="${SMOKE_PASSWORD:-SmokeTest12345!}"

echo "==> Health $BASE_URL/api/health"
HEALTH=$(curl -sS -m 120 "$BASE_URL/api/health")
echo "$HEALTH"
echo "$HEALTH" | grep -q '"ok":true\|"ok": true' || { echo "FAIL: health"; exit 1; }

echo "==> Register customer $EMAIL"
curl -sS -m 60 -X POST "$BASE_URL/api/users/register" \
  -H 'Content-Type: application/json' \
  -d "{\"role\":\"customer\",\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Smoke Rider\"}" \
  | tee /tmp/smoke_reg.json
echo

echo "==> Login"
LOGIN=$(curl -sS -m 60 -X POST "$BASE_URL/api/users/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
echo "$LOGIN" | tee /tmp/smoke_login.json
TOKEN=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))' <<<"$LOGIN")
test -n "$TOKEN" || { echo "FAIL: no token"; exit 1; }

echo "==> Create cash ride"
RIDE=$(curl -sS -m 60 -X POST "$BASE_URL/api/rides" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "pickup_text":"Cape Town Station",
    "pickup_lat":-33.9258,
    "pickup_lng":18.4232,
    "dropoff_text":"V&A Waterfront",
    "dropoff_lat":-33.9036,
    "dropoff_lng":18.4205,
    "vehicle_type":"Car",
    "payment_method":"cash"
  }')
echo "$RIDE" | tee /tmp/smoke_ride.json
RIDE_ID=$(python3 -c 'import json,sys; d=json.load(sys.stdin); data=d.get("data") or d; print(data.get("ride_id") or (data.get("ride") or {}).get("id") or d.get("id") or "")' <<<"$RIDE")
test -n "$RIDE_ID" || { echo "FAIL: no ride id"; exit 1; }
echo "ride_id=$RIDE_ID"

echo "==> Try mock-pay (only if ALLOW_MOCK_PAYMENTS=1 on server)"
curl -sS -m 60 -X POST "$BASE_URL/api/payments/mock-pay" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"ride_id\":$RIDE_ID}" \
  | tee /tmp/smoke_pay.json || true
echo
echo "NOTE: Real cash settle needs a driver JWT → POST /api/payments/cash"
echo "OK: legacy smoke (health + login + cash ride create) passed against $BASE_URL"
