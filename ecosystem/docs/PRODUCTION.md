# My Ride SA — Production runbook

## Stack

- **API**: FastAPI (`ecosystem/backend`) — AI dispatch, pricing, support, payments, auth
- **Store**: Firestore *or* in-memory (default); optional **Postgres dual-write** via `DATABASE_URL`; **Part 11 primary** with `USE_POSTGRES_PRIMARY=true` (trips → `ride_events`)
- **Cache**: Redis (optional in dev; required for multi-instance rate limits later)
- **Apps**: Flutter Rider / Driver / Admin → same API (`API_BASE_URL`)
- **Hub**: Branded web login at `/`

## Quick start (local prod-like)

```bash
cd ecosystem/backend
cp .env.example .env
docker compose up -d postgres redis
DEBUG=true .venv/bin/python run.py
# or: make -C .. api
```

- Hub: http://127.0.0.1:8000/
- Docs: http://127.0.0.1:8000/docs
- Health: http://127.0.0.1:8000/health
- Admin ops: http://127.0.0.1:8000/admin

### Demo accounts

| Role | Email | Password |
|------|-------|----------|
| Rider | `rider@myride.co.za` | `ride123` |
| Driver | `driver@myride.co.za` | `drive123` |
| Admin | `admin@myride.co.za` | `admin123` |

## Production env (must set)

```bash
ENVIRONMENT=production
DEBUG=false
JWT_SECRET=<long-random>
CORS_ORIGINS=https://app.yourdomain.co.za
DATABASE_URL=postgresql://...
USE_POSTGRES_PRIMARY=true
STRIPE_LIVE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
# Optional live AI / Twilio
OPENAI_API_KEY=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
PUBLIC_BASE_URL=https://api.yourdomain.co.za
```

Startup **fails** if JWT is still the dev secret, DEBUG is true, or CORS is `*` while `ENVIRONMENT=production`.

## Auth model

- `POST /auth/login` → Bearer JWT
- Money + ride mutations require role JWT (`rider` / `driver` / `admin`)
- Admin-only: `/admin/metrics`, `/payments/reconcile/*`, `/payments/ledger`, `/payments/transfer`

## Compose

```bash
cd ecosystem
make up      # api + postgres + redis (dev)
make smoke  # HTTP smoke (API must be up)
make down

# Production stack (Postgres/Redis not published to host)
cd backend
cp .env.prod.example .env.prod   # fill secrets
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

## Smoke

```bash
./backend/scripts/smoke_test.sh
```

## Cutover

Full checklist: **[CUTOVER.md](./CUTOVER.md)** (Phases A–C: legacy Render, FastAPI deploy, webhooks/go-no-go).  
Render FastAPI: **[RENDER_ECOSYSTEM.md](./RENDER_ECOSYSTEM.md)**.

1. Point Flutter `--dart-define=API_BASE_URL=https://api...` (leave `LEGACY_BACKEND` unset/false).
2. Configure Stripe webhooks → `/webhooks/stripe` (signature required in production).
3. Configure Twilio voice/SMS/WhatsApp → `/voice/*`, `/webhooks/sms`, `/webhooks/whatsapp` (`PUBLIC_BASE_URL` must match).
4. Enable `USE_POSTGRES_PRIMARY=true` after dual-write soak.
5. Replace demo accounts with real user store before public launch.
