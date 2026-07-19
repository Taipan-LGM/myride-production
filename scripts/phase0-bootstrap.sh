#!/usr/bin/env bash
# Phase 0: ~100 drivers + ~1000 completed rides via admin API.
set -euo pipefail
HOST="${ECOSYSTEM_HOST:-http://127.0.0.1:8000}"
DRIVERS="${PHASE0_DRIVERS:-100}"
RIDES="${PHASE0_RIDES:-1000}"

echo "Host=$HOST drivers=$DRIVERS rides=$RIDES"
python3 - <<PY
import json, os, urllib.request, urllib.error
host=os.environ.get("ECOSYSTEM_HOST","http://127.0.0.1:8000").rstrip("/")
drivers=int(os.environ.get("PHASE0_DRIVERS","100"))
rides=int(os.environ.get("PHASE0_RIDES","1000"))

def call(method, path, data=None, token=None):
    headers={"Content-Type":"application/json"}
    if token: headers["Authorization"]=f"Bearer {token}"
    body=None if data is None else json.dumps(data).encode()
    req=urllib.request.Request(host+path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw=e.read().decode()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, {"raw": raw[:300]}

st, login = call("POST","/auth/login",{"identifier":"admin@myride.co.za","password":"admin123","role":"admin"})
assert st==200, login
tok=login["access_token"]
print("admin_login_ok")
st2, body = call("POST", f"/admin/phase0/bootstrap?drivers={drivers}&rides={rides}", token=tok)
print("bootstrap_http", st2)
print(json.dumps(body, indent=2)[:800])
assert st2==200, body
print("PHASE0 OK")
PY
