# My Ride

Single-site e‑hailing demo ecosystem (marketing + customer + driver + admin) built with:
- Express (ESM) + Socket.io
- SQLite (`better-sqlite3`)
- JWT auth
- Stripe Checkout + webhook (test mode)

## Local development

1. Install dependencies:

```bash
npm install
```

2. Create your env file:
- Copy `.env.example` → `.env`
- Set `JWT_SECRET` to a long random string

3. Start dev server:

```bash
npm run dev
```

App runs on `http://localhost:3000`.

## Deploy to Render (quick checklist)

### Service type
- Use a **Web Service** running Node.js.

### Start command
- Recommended: `npm start`

### Environment variables (minimum)
- **Server**
  - `NODE_ENV=production`
  - `HOST=0.0.0.0`
  - `PORT` (Render provides this automatically; your app should respect it)
  - `APP_ORIGINS=https://<your-app>.onrender.com`
- **Auth**
  - `JWT_SECRET=<long random string>`
  - `JWT_EXPIRES_IN=7d` (optional)
- **Database**
  - `SQLITE_PATH=/var/data/myride.sqlite` (recommended on a persistent disk; see note below)
- **Stripe (test mode)**
  - `STRIPE_SECRET_KEY=sk_test_...`
  - `STRIPE_WEBHOOK_SECRET=whsec_...`
  - `STRIPE_SUCCESS_URL=https://<your-app>.onrender.com/#/customer?paid=1`
  - `STRIPE_CANCEL_URL=https://<your-app>.onrender.com/#/customer?paid=0`

### Stripe webhook
Create a webhook endpoint in Stripe pointing to:
- `https://<your-app>.onrender.com/api/payments/webhook`

Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

### SQLite persistence warning (important)
Render web service filesystems are often **ephemeral**. If you keep `SQLITE_PATH` on the default filesystem, you may lose data on deploy/restart.

To persist data:
- Add a **Render Disk** (e.g. mounted at `/var/data`)
- Set `SQLITE_PATH=/var/data/myride.sqlite`

### `better-sqlite3` native module note
`better-sqlite3` is a native module and must be built against the Node version used in the deploy environment.
- On Render, set a consistent Node version (or use the platform default consistently).

## Repo hygiene
- `.env` is intentionally ignored by git (see `.gitignore`). Use `.env.example` for sharing config shape.

## My Ride — Full e-hailing web ecosystem (one website)

This repo runs **one web app** at `http://localhost:3000` with:
- Public marketing site (guest)
- Customer web app (role = `customer`)
- Driver web app (role = `driver`)
- Admin back office (role = `admin`)
- One shared backend API + SQLite DB
- Real-time simulation via WebSockets (Socket.io) + polling fallback
- Stripe Checkout payment (test mode) required to complete ride

---

## Prerequisites

- Node.js 18+ (recommended 20+)
- A Stripe account (test mode keys) for payment flow

---

## Run locally

From the repo root:

```bash
npm install
cp .env.example .env
npm run db:init
npm run seed:drivers
npm run dev
```

Open:
- `http://localhost:3000`

---

## Admin login (auto-bootstrap)

On boot, the server will create an admin user **if** these are set in `.env`:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`

Defaults (from `.env.example`):
- Email: `admin@mycab.local`
- Password: `Admin12345!`

---

## End-to-end test (customer → driver → payment → complete)

### 1) Admin (approve drivers optional)

- Go to `#/admin`
- Login with admin credentials above
- (Optional) Click **Seed 8 Drivers**
- Click **Refresh Drivers** and confirm drivers exist and are `approved`

### 2) Driver (go online)

- Go to `#/driver`
- Login as a seeded driver:
  - Seeded password: `Driver12345!`
  - Seeded emails are random — easiest way is Admin → Refresh Drivers and copy a driver email.
- Click **Update Location (mock)**
- Click **Go Online**

### 3) Customer (request ride)

- Go to `#/customer`
- Register a customer account
- Fill pickup/dropoff + choose vehicle type
- Click **Request Ride**
- Matching is mock: nearest online approved driver of same vehicle type.

### 4) Driver (accept + start)

- Driver receives the request in “Incoming Requests”
- Click **Accept**
- Click **Start Ride**
- Click **End Ride → Request Payment**

### 5) Customer (pay with Stripe test)

- Customer sees payment status `requires_payment`
- Click **Pay with Stripe (test)**
- Use test card:
  - `4242 4242 4242 4242` (any future expiry, any CVC, any ZIP)

### 6) Driver (complete)

- After webhook confirms `paid`, driver can click **Complete (requires paid)**

---

## Stripe setup (test mode)

In Stripe Dashboard (Test mode):
1. Get API key (Developers → API keys)
   - Set `STRIPE_SECRET_KEY`
2. Create webhook endpoint:
   - URL: `http://localhost:3000/api/payments/webhook`
   - Events: `checkout.session.completed`, `payment_intent.payment_failed`
   - Set `STRIPE_WEBHOOK_SECRET`

Restart server after changing `.env`.

Local webhook forwarding (recommended):

```bash
stripe listen --forward-to localhost:3000/api/payments/webhook
```

Copy the `whsec_...` printed by Stripe CLI into `.env` as `STRIPE_WEBHOOK_SECRET`.

---

## Deploy to Render (summary)

- Web service build: `npm install`
- Start: `npm start`
- Env vars:
  - `NODE_ENV=production`
  - `APP_ORIGIN=https://<your-render-url>`
  - `JWT_SECRET=...`
  - `SQLITE_PATH=./mycab.sqlite`
  - `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_SUCCESS_URL=https://<render-url>/#/customer?paid=1`
  - `STRIPE_CANCEL_URL=https://<render-url>/#/customer?paid=0`

Stripe webhook on Render:
- `https://<render-url>/api/payments/webhook`

