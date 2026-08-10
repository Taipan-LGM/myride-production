# Ecosystem FastAPI — Render / Docker deploy

**Stack:** FastAPI + (optional) Render Postgres + Redis  
**Version:** `ecosystem/backend/app/__init__.py` → **0.3.1**
**Hub:** `/` · Health: `/health` · Docs: `/docs`  
**Local Docker:** `docker compose -f docker-compose.prod.yml` (see Makefile `up-prod`)

---

## Option 1 — Render Blueprint (recommended)

Root [`render.yaml`](../../render.yaml) defines:

| Service | Name | Role |
|---------|------|------|
| web (Docker) | `my-ride-ecosystem` | Path A FastAPI hub |
| redis | `myride-redis` | Cache / rate-limit ready |
| postgres | `myride-pg` | Trips / ledger |

### Apply blueprint

1. Render Dashboard → **New** → **Blueprint** → connect `Taipan-LGM/My-Ride`  
2. Or: existing workspace → **Apply render.yaml** from `master`  
3. After first deploy, set **sync: false** secrets (below) in Dashboard  
4. Note public URL: `https://my-ride-ecosystem.onrender.com` (or custom domain)

**Status (2026-08-06):** release `0.3.1` retains Redis/PostgreSQL primary operation, disables Phase-0 seeding, and retires the unused legacy service from the Blueprint.

### Env to set in Dashboard (ecosystem service)

| Key | Example / rule |
|-----|----------------|
| `ENVIRONMENT` | `production` |
| `DEBUG` | `false` |
| `JWT_SECRET` | Generate (≥32 chars, **not** `my-ride-sa-dev-*`) |
| `CORS_ORIGINS` | `https://my-ride-ecosystem.onrender.com` (+ Flutter web origin if any) — **no `*`** |
| `PUBLIC_BASE_URL` | Same HTTPS origin (Twilio signature base) |
| `DATABASE_URL` | From `myride-pg` (auto if blueprint `fromDatabase`) |
| `REDIS_URL` | From `myride-redis` (auto if linked) |
| `USE_POSTGRES_PRIMARY` | `false` until dual-write soak; then `true` |
| `STRIPE_LIVE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Live cutover |
| `TWILIO_*` | Live channels |
| `OPENAI_API_KEY` | Optional (heuristic AI without it) |

Production boot **refuses** weak JWT, `DEBUG=true`, or `CORS_ORIGINS=*`.

### Postgres schema (first time)

```bash
# From a laptop with psql + Render external DB URL
psql "$DATABASE_URL" -f ecosystem/backend/database/init.sql
```

Or Render Shell on the ecosystem service if `psql`/`database/init.sql` available in image.

### Smoke

```bash
HOST=https://my-ride-ecosystem.onrender.com
curl -sS "$HOST/health"
curl -sS -o /dev/null -w "%{http_code}\n" "$HOST/"
# Login hub with demo accounts only in non-public staging
```

---

## Option 2 — Docker Compose (VPS / local prod-like)

```bash
cd "/home/taipan/Documents/My Ride/ecosystem/backend"
cp .env.prod.example .env.prod
# edit JWT_SECRET, POSTGRES_PASSWORD, PUBLIC_BASE_URL, CORS_ORIGINS, Stripe/Twilio
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
curl -sS http://127.0.0.1:8000/health
```

Or from ecosystem root: `make up-prod`

---

## Dockerfile notes

- Image: `ecosystem/backend/Dockerfile`  
- Listens on **`$PORT`** (Render) via `run.py`  
- Includes `database/init.sql` for operators  
- Non-root user `appuser`

---

## Flutter clients

```bash
flutter run --dart-define=API_BASE_URL=https://my-ride-ecosystem.onrender.com
```

Leave `LEGACY_BACKEND` unset/false for Path A.

---

## Full go-live checklist

→ [CUTOVER.md](./CUTOVER.md)
