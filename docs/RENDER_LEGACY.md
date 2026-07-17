# Legacy Render — env & deploy checklist

**Stack:** Express + SQLite + Socket.io (`npm start` → `backend/server.js`)  
**Version:** `package.json` → **1.0.3**  
**Repo:** https://github.com/Taipan-LGM/My-Ride · branch `master`  
**Blueprint:** root [`render.yaml`](../render.yaml) service `my-ride`

Use this for the **current** Render web service (marketing + customer + driver + admin SPA).

---

## 1. Confirm service settings (Dashboard)

| Setting | Expected |
|---------|----------|
| Runtime | Node |
| Build | `npm install` |
| Start | `npm start` (or `node backend/server.js`) |
| Health check | `/api/health` |
| Node | `20` (`.node-version`) |
| Disk | `/var/data` → `SQLITE_PATH=/var/data/myride.sqlite` (starter+) |

---

## 2. Required env vars

| Key | Required | Notes |
|-----|----------|-------|
| `NODE_ENV` | Yes | `production` |
| `HOST` | Yes | `0.0.0.0` |
| `JWT_SECRET` | Yes | Long random (Render “generate” OK) |
| `SQLITE_PATH` | Yes | `/var/data/myride.sqlite` with disk |

## 3. Strongly recommended

| Key | Notes |
|-----|-------|
| `APP_ORIGINS` / `EXTRA_APP_ORIGINS` | Exact HTTPS origins of this Render URL + custom domain |
| `STRIPE_SECRET_KEY` | `sk_live_…` or `sk_test_…` — **optional for boot** (lazy Stripe). Card pay needs a real key. |
| `STRIPE_PUBLISHABLE_KEY` | Match mode (test/live) |
| `STRIPE_WEBHOOK_SECRET` | Dashboard webhook → `https://<host>/api/payments/webhook` (confirm path in `routes/payments.js`) |
| `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` | `https://<host>/#/customer?paid=1` (and `paid=0`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Bootstrap admin if missing |
| `GOOGLE_PLACES_API_KEY` | Address search; else Nominatim |

## 4. Demo / caution flags

| Key | When |
|-----|------|
| `STRIPE_ALLOW_TEST_KEYS_IN_PRODUCTION=1` | Only for demo with `sk_test_…` |
| `ALLOW_MOCK_PAYMENTS=1` | Only if mock-pay must work in prod |
| `HELMET_DISABLE_CSP=1` | Hotfix only if CSP breaks assets |

---

## 5. Post-deploy smoke (legacy)

```bash
# Replace HOST with your Render URL
HOST=https://my-ride.onrender.com

curl -sS "$HOST/api/health"
curl -sS -o /dev/null -w "%{http_code}\n" "$HOST/"
# Expect 200 on health; open SPA in browser (customer / driver / admin login)
```

- [ ] Health 200  
- [ ] SPA loads (no blank CSP block)  
- [ ] Login works  
- [ ] Geocode suggest returns results  
- [ ] Cash ride path works without Stripe  
- [ ] Card path only after `STRIPE_SECRET_KEY` set  

Local preflight: `npm run deploy:check`

---

## 6. Known footguns

1. **Empty `STRIPE_SECRET_KEY`** — fixed (`5a6ab59`): server boots; card APIs return not-configured.  
2. **Ephemeral disk on free** — SQLite wiped on redeploy; use starter + disk.  
3. **Webhook path** — must match Express route + Stripe dashboard URL.  
4. **This is not Path A** — AI hub / Flutter FastAPI is a **separate** service (`my-ride-ecosystem`). See [ecosystem/docs/RENDER_ECOSYSTEM.md](../ecosystem/docs/RENDER_ECOSYSTEM.md).

---

## 7. Next after legacy green

→ Deploy / cutover **ecosystem** FastAPI: [RENDER_ECOSYSTEM.md](../ecosystem/docs/RENDER_ECOSYSTEM.md) + [CUTOVER.md](../ecosystem/docs/CUTOVER.md).
