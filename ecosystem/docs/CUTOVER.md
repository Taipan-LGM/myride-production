# Cutover checklist — My Ride SA → live (A + B + C)

**Ecosystem version:** `0.2.1` · **Legacy web:** `1.0.3`  
**Repo:** https://github.com/Taipan-LGM/My-Ride  

This is the single go-live checklist covering:

| Track | Doc |
|-------|-----|
| **A)** Legacy Render env | [docs/RENDER_LEGACY.md](../../docs/RENDER_LEGACY.md) |
| **B)** FastAPI on Render/Docker | [RENDER_ECOSYSTEM.md](./RENDER_ECOSYSTEM.md) |
| **C)** This cutover | below |

**Local hub (dev):** http://127.0.0.1:8000/  
**Path A Render (verified 2026-07-18):** https://my-ride-ecosystem.onrender.com — `/health` 200 · hub `/` 200 · `/safety/emergency` → **112**

### Way forward (brief Path A — keep shipping)

| # | Step | Status |
|---|------|--------|
| 1 | Staging URL live (Render ecosystem) | Done — health/hub/112 |
| 2 | Local PM hub + API smoke (book/SOS/channels) | Done — `scripts/smoke_test.sh` |
| 3 | Compose/VPS prod stack | Blocked — install Docker (sudo), then `scripts/up-prod-compose.sh` |
| 4 | Fix Render driver cold-store 500 | In progress — deploy driver-availability fix |
| 5 | Flutter → ecosystem host (not legacy Node) | Script: `ecosystem/run-rider-staging.sh` |
| 6 | Live Stripe/Twilio webhooks + `PUBLIC_BASE_URL` | Needs Dashboard secrets |
| 7 | Go/no-go: book + pay + SOS + admin JWT | After 4–6 |
| 8 | Rotate/disable demo accounts before public | Before open traffic |

Brief PART 13 (K8s/RN/Elixir) **mapped to Path A:** Compose/Render instead of kubectl; Flutter instead of RN; FastAPI WS instead of Phoenix.

---

## Phase A — Legacy Render green

Service: `my-ride` (Node)

- [x] Deploy from `master` succeeds (Render reports deploy successful; confirm `/api/health` 200 from your network)
- [ ] Disk + `SQLITE_PATH=/var/data/myride.sqlite`
- [x] `JWT_SECRET` set (≥32 chars — required for production boot)
- [ ] `EXTRA_APP_ORIGINS` includes production URL
- [ ] Stripe keys optional for boot; set before card payments
- [ ] SPA login + cash ride smoke OK
- [ ] Full checklist: [RENDER_LEGACY.md](../../docs/RENDER_LEGACY.md)
- [ ] Public URL confirmed (paste Dashboard **URL** if not `https://my-ride.onrender.com`)

---

## Phase B — Ecosystem API live

Service: `my-ride-ecosystem` (Docker) **or** `make up-prod` on a VPS

### B0. Preflight (local)

- [ ] `cd ecosystem && make test` green
- [ ] `make smoke` green against local API
- [ ] Confirm prod guards: weak JWT / `DEBUG=true` / `CORS_ORIGINS=*` fail when `ENVIRONMENT=production`

### B1. Provision

- [ ] Apply root `render.yaml` Blueprint **or** compose prod stack
- [ ] Postgres `myride-pg` linked → `DATABASE_URL`
- [ ] Redis `myride-redis` linked → `REDIS_URL`
- [ ] Run schema: `psql "$DATABASE_URL" -f ecosystem/backend/database/init.sql`

### B2. Secrets (Dashboard / `.env.prod`)

- [ ] `JWT_SECRET` long random (not `my-ride-sa-dev-*`)
- [ ] `CORS_ORIGINS` = exact hub URL(s), **no `*`**
- [ ] `PUBLIC_BASE_URL=https://…` (same host Twilio will call)
- [ ] `ENVIRONMENT=production` · `DEBUG=false`
- [ ] `USE_POSTGRES_PRIMARY=false` until soak; then `true`
- [ ] Stripe live: `STRIPE_LIVE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
- [ ] Twilio SID / auth / SA numbers
- [ ] OpenAI only if leaving heuristic mode

### B3. Smoke

```bash
HOST=https://my-ride-ecosystem.onrender.com   # or your domain
curl -sS "$HOST/health"
curl -sS -o /dev/null -w "%{http_code}\n" "$HOST/"
```

- [x] `/health` 200 · hub `/` loads (`https://my-ride-ecosystem.onrender.com`)
- [ ] Demo login works on **staging only**

Details: [RENDER_ECOSYSTEM.md](./RENDER_ECOSYSTEM.md)

### B4. Compose / VPS (`make up-prod`)

Needs Docker on host (not installed here yet — run install in a local terminal):

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"
# re-login / newgrp docker, then:
# stop local uvicorn on :8000 if running
cd "/home/taipan/Documents/My Ride/ecosystem"
# backend/.env.prod must have real JWT_SECRET + POSTGRES_PASSWORD (not replace-with-*)
make up-prod
curl -sS http://127.0.0.1:8000/health
```

- [ ] Docker installed · `docker compose version` works
- [ ] `backend/.env.prod` filled (gitignored)
- [ ] `make up-prod` · `/health` 200

---

## Phase C — Channels, clients, go/no-go

### C1. Webhooks (fail-closed)

| Provider | URL | Verify |
|----------|-----|--------|
| Stripe | `POST /webhooks/stripe` | `Stripe-Signature` + `STRIPE_WEBHOOK_SECRET` |
| WhatsApp | `POST /webhooks/whatsapp` | `X-Twilio-Signature` + `TWILIO_AUTH_TOKEN` |
| SMS | `POST /webhooks/sms` | same |
| Voice | `POST /voice/incoming`, `/voice/gather` | same |

- [ ] Stripe dashboard → ecosystem `PUBLIC_BASE_URL`
- [ ] Twilio voice/SMS/WA → same host
- [ ] Unsigned Stripe rejected in production
- [ ] Bad Twilio signature → 403

### C2. Clients

```bash
# Point Flutter at ecosystem FastAPI (NOT legacy Node)
export API_BASE_URL=https://my-ride-ecosystem.onrender.com   # or your custom domain
cd "/home/taipan/Documents/My Ride/ecosystem"
./run-rider.sh
# or: cd frontend && source scripts/dart_defines.sh && flutter run "${DART_DEFINES[@]}"
```

- [ ] Flutter: `--dart-define=API_BASE_URL=https://<ecosystem-host>` (`./run-rider-staging.sh`)
- [x] Hub brand at ecosystem `/`
- [x] SOS dials **112** (SA) — `/safety/emergency` + Flutter SOS
- [x] Refund auto-cap **R500** still enforced (`CustomerServiceAI.MAX_AUTO_REFUND`)

### C1b. Legacy vs ecosystem Stripe webhooks

| Stack | Stripe endpoint |
|-------|-----------------|
| Legacy Node | `https://<my-ride-host>/api/payments/webhook` |
| Ecosystem FastAPI | `https://<ecosystem-host>/webhooks/stripe` |

Twilio (ecosystem only): `/webhooks/whatsapp`, `/webhooks/sms`, `/voice/incoming`, `/voice/gather` — `PUBLIC_BASE_URL` must match.

### C3. Go / no-go

- [ ] Book ride (hub + Flutter)
- [ ] Payment hold/capture (Stripe)
- [ ] One live WhatsApp / SMS / voice message each (if Twilio live)
- [ ] Admin metrics only with admin JWT
- [ ] Rate limit does not starve hub
- [ ] Demo accounts **rotated or disabled** before public traffic
- [ ] `USE_POSTGRES_PRIMARY=true` after dual-write soak

### C4. Traffic split (until full cutover)

| Audience | URL |
|----------|-----|
| Legacy SPA / existing Render users | `my-ride` service |
| AI hub + Flutter Path A | `my-ride-ecosystem` |

Do **not** point Flutter at the legacy Node host.

---

## Rollback

1. Render → previous deploy / git tag for the failing service  
2. `USE_POSTGRES_PRIMARY=false` if trip reads fail  
3. Disable Stripe/Twilio webhooks in provider dashboards  
4. Keep Postgres/Redis (Render) or compose volumes (`*_prod`)  

---

## Quick command index

```bash
# Legacy local check
npm run deploy:check

# Legacy Render smoke (health + register/login + cash ride create)
BASE_URL=https://my-ride.onrender.com ./scripts/smoke-legacy-render.sh

# Ecosystem tests / smoke
cd "/home/taipan/Documents/My Ride/ecosystem"
make test
make api    # terminal 1
make smoke  # terminal 2

# Compose prod-like
cd backend && cp .env.prod.example .env.prod   # edit
make -C .. up-prod

# Postgres schema (Render external DB URL from Dashboard)
psql "$DATABASE_URL" -f ecosystem/backend/database/init.sql
```
