#!/usr/bin/env bash
# Section D — Phase 0 ops prep (metrics + seed tooling; real fleet is ops).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${ECOSYSTEM_HOST:-https://my-ride-ecosystem.onrender.com}"

echo "=== D1. Live cutover snapshot ==="
curl -sS -m 40 "$HOST/ops/cutover" | tee /tmp/d-cutover.json | python3 -m json.tool

echo "=== D2. Admin metrics (demo admin — staging only) ==="
# Login without printing token
python3 - <<'PY'
import json, urllib.request, os
host=os.environ.get("ECOSYSTEM_HOST","https://my-ride-ecosystem.onrender.com")
req=urllib.request.Request(
    host+"/auth/login",
    data=json.dumps({"identifier":"admin@myride.co.za","password":"admin123","role":"admin"}).encode(),
    headers={"Content-Type":"application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=45) as r:
    tok=json.loads(r.read())["access_token"]
req2=urllib.request.Request(host+"/admin/metrics", headers={"Authorization":f"Bearer {tok}"})
with urllib.request.urlopen(req2, timeout=45) as r:
    body=json.loads(r.read())
# Print counts only
keys=list(body.keys()) if isinstance(body, dict) else []
print("metrics_keys=", keys[:20])
for k in ("trips","rides","drivers","riders","active_trips","completed_trips","online_drivers"):
    if isinstance(body, dict) and k in body:
        print(f"  {k}=", body[k] if not isinstance(body[k], (dict,list)) else type(body[k]).__name__)
# nested common shapes
if isinstance(body, dict):
    for k,v in body.items():
        if isinstance(v, (int, float, str, bool)):
            print(f"  {k}={v}")
        elif isinstance(v, dict) and "count" in v:
            print(f"  {k}.count={v['count']}")
print("TOKEN_LEN", len(tok))
PY

echo "=== D3. Phase 0 targets (ops checklist) ==="
cat <<'EOF'
Brief Phase 0 launch targets (ops, not code):
  [ ] ~100 drivers onboarded (KYC + vehicles) — use Admin hub + driver app
  [ ] ~1,000 completed rides — grow via hub / Flutter / WhatsApp simulate → live Twilio
  [ ] Channels live: App + Web + Voice + WhatsApp (needs Twilio secrets)
  [ ] Before public: ALLOW_DEMO_ACCOUNTS=false on Render
  [ ] Before public: Stripe live keys + webhook configured
EOF

echo "=== D4. Bulk demo driver seed helper (local DEBUG only) ==="
# Document endpoint; only works with DEBUG=true
cat <<'EOF'
Local (DEBUG=true):
  curl -X POST http://127.0.0.1:8000/dev/seed
Production: seed disabled — onboard real drivers via admin tools.
EOF

echo "SECTION D OK — ops prep + metrics path verified"
echo "PUBLIC LAUNCH BLOCKERS (from /ops/cutover missing[]):"
python3 -c 'import json; d=json.load(open("/tmp/d-cutover.json")); print(" ", ", ".join(d.get("missing") or ["none"]))'
