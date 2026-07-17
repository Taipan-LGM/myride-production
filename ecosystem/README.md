# My Ride Ecosystem (`my_ride_ecosystem`)

**My Ride SA** — AI-operated e-hailing (FastAPI + Flutter). Separate from the legacy Express app in the parent folder.

## Local URLs

| Surface | URL |
|---------|-----|
| **Login + full ecosystem** | **http://127.0.0.1:8000/** |
| Admin ops page | http://127.0.0.1:8000/admin |
| API docs | http://127.0.0.1:8000/docs |

### Demo logins

| Role | Email | Password |
|------|-------|----------|
| Rider | `rider@myride.co.za` | `ride123` |
| Driver | `driver@myride.co.za` | `drive123` |
| Admin | `admin@myride.co.za` | `admin123` |

Brand logos live in `backend/app/static/brand/`.

### 4 ways to book

📱 App · 💻 Website (hub) · 📞 Phone · 💬 WhatsApp — see [docs/CHANNELS.md](./docs/CHANNELS.md).  
Website pickup: **Use current location** on Book ride.

### Hub extras (Path A)

- **Safety · SOS** — dial **112**, share live trip
- **Wallet · Loyalty · Places** — ZAR balance, tiers, home/work
- **Driver earnings** — today’s ZAR + trip cut (~80%)
- **Carbon** — CO₂e on fare estimate + trip receipt

## One-command start

```bash
cd "/home/taipan/Documents/My Ride/ecosystem"

# Terminal 1 — API (+ optional Redis)
make api
# or: ./run-api.sh

# Terminal 2 — Rider UI
./run-rider.sh

# Terminal 3 — Driver UI
./run-driver.sh
```

Then open **http://127.0.0.1:8000/** (login hub) or **/admin**.

## Tests & smoke

```bash
cd "/home/taipan/Documents/My Ride/ecosystem"
make test
make api   # separate terminal
make smoke
```

## Structure

```
ecosystem/
├── backend/     # FastAPI — AI brain, trips, voice/WA/SMS, Stripe, auth, admin
├── frontend/    # Flutter — Rider, Driver, Admin flavors
├── docs/        # Architecture, production runbook
├── Makefile     # make api | up | test | smoke | urls
└── scripts/     # unblock-emulator.sh
```

## AI Brain

- SmartRouter · DynamicPricing (ZAR) · CustomerServiceAI · Fraud · Safety
- Channels: App · Voice · WhatsApp · SMS
- `POST /ai/book` creates trip + WebSocket `ride_offer` to matched drivers
- Complete ride → auto payment reconciliation
- Role JWT on money + ride mutations; Postgres dual-write when `DATABASE_URL` set

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), [docs/PRODUCTION.md](./docs/PRODUCTION.md), [docs/CUTOVER.md](./docs/CUTOVER.md), and [docs/RENDER_ECOSYSTEM.md](./docs/RENDER_ECOSYSTEM.md).

Legacy Render (Node): [../docs/RENDER_LEGACY.md](../docs/RENDER_LEGACY.md) · root `render.yaml` (dual-stack).

**Version:** `0.2.0` (API `app.__version__`)

## Environment

```bash
cd backend && cp .env.example .env
# Optional: OPENAI_API_KEY, TWILIO_*, STRIPE_*, DATABASE_URL
# Full stack: make up  (api + postgres + redis)
# Production: cp .env.prod.example .env.prod && make up-prod
```

Without keys → full **dev mode** (in-memory DB, heuristic AI, mock Stripe/Twilio).

Legacy Node/SQLite: [docs/LEGACY.md](./docs/LEGACY.md).
