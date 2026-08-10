# Backend — FastAPI

Python API for riders, drivers, trips, AI brain, Twilio voice/WhatsApp, and Stripe payments.

## Structure

```
backend/
├── app/
│   ├── main.py                 # REST + WebSocket + webhooks
│   ├── ai_dispatcher.py        # Orchestrates AI brain modules
│   ├── ai/                     # AI Brain (Milestone 1)
│   │   ├── smart_router.py     # Multi-factor driver matching
│   │   ├── dynamic_pricing.py  # ZAR dynamic fares + surge
│   │   ├── customer_service.py # Autonomous support (≤ R500)
│   │   ├── fraud_detection.py  # Rule-based fraud scoring
│   │   ├── safety_monitor.py   # Trip telemetry alerts
│   │   └── prompts/            # LLM system prompts
│   ├── twilio_voice.py
│   ├── whatsapp_handler.py
│   ├── stripe_service.py
│   ├── firestore_db.py
│   ├── geofire.py
│   ├── extended_routes.py      # Flutter-compatible routes
│   └── models.py
├── tests/ai/                   # AI unit tests
├── admin_otp_server.py
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── start_api.sh
```

## Run locally

```bash
cd backend
cp .env.example .env
./start_api.sh
# → http://127.0.0.1:8000/health
```

**Docker:**
```bash
docker compose up --build
docker compose --profile tunnel up   # ngrok for Twilio webhooks
```

**Tests:**
```bash
make test
# or: .venv/bin/python -m pytest tests/ai -q
```

## Key endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Service status |
| POST | `/trips` | Create trip |
| POST | `/trips/{id}/assign` | Assign driver |
| POST | `/drivers/nearby` | Geohash driver search |
| POST | `/ai/parse` | Natural-language intent |
| POST | `/ai/book` | AI booking (router + pricing + fraud) |
| POST | `/ai/support` | CustomerServiceAI resolution |
| POST | `/fare-estimate` | DynamicPricing ZAR breakdown |
| POST | `/payments/hold` | Stripe PaymentIntent hold |
| POST | `/webhooks/whatsapp` | Twilio WhatsApp |
| POST | `/voice/incoming` | Twilio voice entry |
| WS | `/ws/trips/{trip_id}` | Live trip events |

## AI Brain notes

- **Dev mode:** no `OPENAI_API_KEY` → heuristic parse/support; no Redis → in-memory zone metrics
- **Currency:** AI fares use **ZAR** (base R15, R12/km, R2/min, min R25)
- **Refunds:** CustomerServiceAI auto-approves up to **R500**; higher → human escalate
- **Safety:** always escalates; advise emergency **112**

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full AI diagram and roadmap.

## Environment

See `backend/.env.example`. Without API keys the server runs in **dev mode** (in-memory DB, heuristic AI, mock Stripe/Twilio).
