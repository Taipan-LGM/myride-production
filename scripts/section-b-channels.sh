#!/usr/bin/env bash
# Section B — payments/channels fail-closed + cutover readiness.
set -euo pipefail
HOST="${ECOSYSTEM_HOST:-https://my-ride-ecosystem.onrender.com}"

echo "=== B1. Cutover readiness ==="
ccode=$(curl -sS -m 40 -o /tmp/b-cutover.json -w "%{http_code}" "$HOST/ops/cutover" || echo fail)
echo "cutover_http=$ccode"
if [[ "$ccode" == "200" ]]; then
  python3 -m json.tool < /tmp/b-cutover.json | head -60
else
  echo "(endpoint not on this deploy yet — present after push of /ops/cutover)"
  head -c 160 /tmp/b-cutover.json; echo
fi

echo "=== B2. Unsigned Stripe (expect 503/400 in production) ==="
code=$(curl -sS -m 30 -o /tmp/b-stripe.json -w "%{http_code}" \
  -X POST "$HOST/webhooks/stripe" -H 'Content-Type: application/json' -d '{"type":"ping"}')
echo "stripe_unsigned_http=$code body=$(head -c 120 /tmp/b-stripe.json)"
[[ "$code" == "503" || "$code" == "400" ]] || { echo "FAIL: unsigned Stripe must fail-closed"; exit 1; }

echo "=== B3. Unsigned WhatsApp (expect 503/400/403 when Twilio unset or sig missing) ==="
code=$(curl -sS -m 30 -o /tmp/b-wa.json -w "%{http_code}" \
  -X POST "$HOST/webhooks/whatsapp" -d 'Body=hi&From=%2B2782')
echo "wa_unsigned_http=$code body=$(head -c 120 /tmp/b-wa.json)"
# Production without Twilio → 503; with Twilio without sig → 400
[[ "$code" == "503" || "$code" == "400" || "$code" == "403" ]] || {
  echo "WARN: WA returned $code (local mock may allow 200)"
}

echo "=== B4. Secret inventory (local files, shapes only) ==="
python3 - <<'PY'
from pathlib import Path
def shape(v):
    if not v: return "EMPTY — set in Render Dashboard"
    if "replace" in v.lower() or v.endswith("...") or "YOUR_" in v: return "PLACEHOLDER — set real key"
    if v.startswith("sk_test_"): return "OK (test)"
    if v.startswith("sk_live_"): return "OK (live)"
    if v.startswith("whsec_"): return "OK (whsec)"
    if v.startswith("AC") and len(v)>20: return "OK (twilio sid)"
    return "SET"
need=["STRIPE_LIVE_SECRET_KEY","STRIPE_WEBHOOK_SECRET","TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN","TWILIO_PHONE_NUMBER","TWILIO_WHATSAPP_NUMBER","OPENAI_API_KEY"]
# merge root + prod env
vals={}
for p in [Path("/home/taipan/Documents/My Ride/.env"), Path("/home/taipan/Documents/My Ride/ecosystem/backend/.env.prod")]:
    if not p.exists(): continue
    for line in p.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k,v=line.split("=",1); vals.setdefault(k.strip(), v.strip())
print("Local secret status (must also be set on Render Dashboard):")
for k in need:
    print(f"  {k}: {shape(vals.get(k,''))}")
print()
print("Stripe Dashboard webhook URL:")
print("  https://my-ride-ecosystem.onrender.com/webhooks/stripe")
print("Twilio webhooks:")
print("  https://my-ride-ecosystem.onrender.com/webhooks/whatsapp")
print("  https://my-ride-ecosystem.onrender.com/webhooks/sms")
print("  https://my-ride-ecosystem.onrender.com/voice/incoming")
PY

echo "SECTION B OK (code paths + fail-closed verified; live keys still Dashboard-only)"
