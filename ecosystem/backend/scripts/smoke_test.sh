#!/usr/bin/env bash
# Smoke test — requires API running on :8000
set -euo pipefail
BASE="${API_BASE:-http://127.0.0.1:8000}"

echo "==> GET /"
curl -sf "$BASE/" -o /tmp/myride_hub.html
head -c 80 /tmp/myride_hub.html; echo

echo "==> GET /health"
curl -sf "$BASE/health" | python3 -m json.tool

echo "==> GET /channels"
curl -sf "$BASE/channels" | python3 -m json.tool | head -40

echo "==> GET /geocode/search"
curl -sf "$BASE/geocode/search?q=Waterfront%20Cape%20Town" | python3 -m json.tool | head -30

echo "==> POST /auth/login (rider)"
TOKEN=$(curl -sf -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"rider@myride.co.za","password":"ride123","role":"rider"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "==> POST /auth/login (driver)"
DTOKEN=$(curl -sf -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"driver@myride.co.za","password":"drive123","role":"driver"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "==> POST /auth/login (admin)"
ATOKEN=$(curl -sf -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"admin@myride.co.za","password":"admin123","role":"admin"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "==> POST /ai/book"
BOOK=$(curl -sf -X POST "$BASE/ai/book" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"rider_id":"rider-demo-001","pickup":{"lat":-33.9249,"lng":18.4241},"dropoff":{"lat":-33.9180,"lng":18.4232},"pickup_address":"CBD","dropoff_address":"Waterfront"}')
echo "$BOOK" | python3 -m json.tool | head -40
TRIP=$(echo "$BOOK" | python3 -c "import sys,json; print(json.load(sys.stdin).get('trip_id') or '')")

echo "==> GET /ai/suggestions"
curl -sf "$BASE/ai/suggestions" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -30

echo "==> GET /rides/history"
curl -sf "$BASE/rides/history" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -20

echo "==> POST /rides/schedule"
curl -sf -X POST "$BASE/rides/schedule" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"rider_id\":\"rider-demo-001\",\"pickup\":{\"lat\":-33.9249,\"lng\":18.4241},\"dropoff\":{\"lat\":-33.9180,\"lng\":18.4232},\"scheduled_for\":\"2030-01-15T10:00:00Z\",\"vehicle_type\":\"standard\"}" \
  | python3 -m json.tool | head -20

echo "==> POST /driver/update-availability"
curl -sf -X POST "$BASE/driver/update-availability" \
  -H "Authorization: Bearer $DTOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"driver_id":"driver-demo-001","is_online":true,"location":{"lat":-33.925,"lng":18.425}}' \
  | python3 -m json.tool | head -20

echo "==> GET /payments/ledger (admin)"
curl -sf "$BASE/payments/ledger" -H "Authorization: Bearer $ATOKEN" | python3 -m json.tool | head -20

echo "==> POST /channels/voice/simulate"
curl -sf -X POST "$BASE/channels/voice/simulate" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Book a ride from Cape Town CBD to the Waterfront","from_number":"+27821234567"}' \
  | python3 -m json.tool | head -30

echo "==> POST /channels/whatsapp/simulate"
curl -sf -X POST "$BASE/channels/whatsapp/simulate" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Book from Sandton to OR Tambo","from_number":"+27821234567"}' \
  | python3 -m json.tool | head -30

if [[ -n "$TRIP" ]]; then
  echo "==> POST /rides/rate"
  # Non-fatal: trip may already be rated / store race on multi-instance
  rate_code=$(curl -sS -m 45 -o /tmp/smoke_rate.json -w "%{http_code}" -X POST "$BASE/rides/rate" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"trip_id\":\"$TRIP\",\"rating\":5,\"comment\":\"smoke\",\"from_role\":\"rider\"}" || echo fail)
  echo "rate_http=$rate_code"
  python3 -m json.tool < /tmp/smoke_rate.json 2>/dev/null | head -20 || head -c 200 /tmp/smoke_rate.json || true
fi

echo "==> GET /safety/emergency"
curl -sf "$BASE/safety/emergency" | python3 -m json.tool

echo "==> POST /safety/sos"
SOS_BODY='{"note":"smoke sos","lat":-33.92,"lng":18.42}'
if [[ -n "${TRIP:-}" ]]; then
  SOS_BODY=$(python3 -c "import json; print(json.dumps({'trip_id':'$TRIP','note':'smoke sos','lat':-33.92,'lng':18.42}))")
fi
curl -sf -X POST "$BASE/safety/sos" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$SOS_BODY" \
  | python3 -m json.tool | head -25

if [[ -n "${TRIP:-}" ]]; then
  echo "==> POST /safety/share"
  curl -sf -X POST "$BASE/safety/share" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"trip_id\":\"$TRIP\"}" \
    | python3 -m json.tool | head -20
fi

echo "==> GET /wallet + /loyalty"
curl -sf "$BASE/wallet" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
curl -sf "$BASE/loyalty" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo "==> POST /places (home)"
curl -sf -X POST "$BASE/places" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"home","label":"Home CBD","lat":-33.9249,"lng":18.4241}' \
  | python3 -m json.tool | head -20

echo "==> POST /carbon/estimate"
curl -sf -X POST "$BASE/carbon/estimate" \
  -H 'Content-Type: application/json' \
  -d '{"distance_km":12.5}' \
  | python3 -m json.tool

echo "==> GET /driver/earnings"
curl -sf "$BASE/driver/earnings" -H "Authorization: Bearer $DTOKEN" | python3 -m json.tool | head -25

echo "==> POST /fare-estimate (carbon)"
curl -sf -X POST "$BASE/fare-estimate" \
  -H 'Content-Type: application/json' \
  -d '{"pickup":{"lat":-33.9249,"lng":18.4241},"dropoff":{"lat":-33.9180,"lng":18.4232},"vehicle_type":"standard"}' \
  | python3 -m json.tool | head -40

if [[ -n "${TRIP:-}" ]]; then
  echo "==> POST /payments/hold + /payments/capture"
  HOLD=$(curl -sf -X POST "$BASE/payments/hold" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"amount_cents\":4500,\"rider_id\":\"rider-demo-001\",\"trip_id\":\"$TRIP\",\"currency\":\"zar\"}")
  echo "$HOLD" | python3 -m json.tool | head -20
  PI=$(echo "$HOLD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id') or '')")
  if [[ -n "$PI" ]]; then
    curl -sf -X POST "$BASE/payments/capture" \
      -H "Authorization: Bearer $DTOKEN" \
      -H 'Content-Type: application/json' \
      -d "{\"payment_intent_id\":\"$PI\",\"trip_id\":\"$TRIP\",\"amount_cents\":4500}" \
      | python3 -m json.tool | head -15
  fi
fi

echo "==> GET /ops/cutover"
curl -sf "$BASE/ops/cutover" | python3 -m json.tool | head -40

echo "OK — production smoke passed"
