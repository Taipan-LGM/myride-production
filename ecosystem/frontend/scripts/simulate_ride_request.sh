#!/usr/bin/env bash
# Simulate a rider request — broadcasts to online drivers via WebSocket.
# Prerequisites:
#   1. Backend running: ./run-api.sh
#   2. Driver app online with toggle ON (driver-demo-001)
set -euo pipefail

API="${API_BASE_URL:-http://localhost:8000}"

echo "POST $API/request-ride"
curl -s -X POST "$API/request-ride" \
  -H "Content-Type: application/json" \
  -d '{
    "rider_id": "test_rider_123",
    "pickup": {"lat": -33.9249, "lng": 18.4241},
    "dropoff": {"lat": -33.9180, "lng": 18.4232},
    "pickup_address": "Cape Town CBD",
    "dropoff_address": "V&A Waterfront",
    "fare_estimate_cents": 2450,
    "payment_intent_id": "pi_test_123"
  }' | python3 -m json.tool 2>/dev/null || cat

echo ""
echo "If driver is online + WebSocket connected, popup should appear on driver home."
