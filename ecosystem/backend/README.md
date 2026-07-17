# Backend — Python FastAPI

Ready-to-run API for My Ride: trips, AI parsing, Twilio voice/WhatsApp, Stripe, Firestore.

## Quick start (local)

```bash
cp .env.example .env    # auto-created by start_api.sh if missing
./start_api.sh          # → http://127.0.0.1:8000
```

Open **http://127.0.0.1:8000/docs** for interactive API docs.

With `DEBUG=true`, demo data is seeded on startup (`rider-demo-001`, `driver-demo-001`, `trip-demo-001`).

## Docker

```bash
cp .env.example .env
docker compose up --build

# Twilio webhooks via ngrok:
docker compose --profile tunnel up --build
```

## Smoke test

```bash
./start_api.sh          # terminal 1
./scripts/smoke_test.sh # terminal 2
```

## Python layout

```
app/
├── main.py               # FastAPI app (REST + WebSocket + webhooks)
├── config.py             # Settings from .env
├── models.py             # Pydantic schemas
├── ai_dispatcher.py      # OpenAI / heuristic intent parsing
├── twilio_voice.py       # Voice TwiML
├── whatsapp_handler.py   # WhatsApp webhooks
├── stripe_service.py     # Payments
├── firestore_db.py       # CRUD (Firestore or in-memory)
├── geofire.py            # Driver proximity
├── redis_cache.py        # Optional Redis cache
├── seed.py               # Demo data
└── deps.py               # Shared dependency exports
```

## Environment

See `.env.example` for all variables. No API keys required for local dev.

## Admin OTP (separate)

```bash
python3 admin_otp_server.py   # port 8788
```
