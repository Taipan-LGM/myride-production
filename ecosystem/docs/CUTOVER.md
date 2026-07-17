# Cutover checklist — My Ride SA ecosystem → live

**Version target:** `0.2.0`  
**Primary hub (local):** http://127.0.0.1:8000/

Use this before pointing real Stripe / Twilio / public DNS at the API.

## 0. Preflight

- [ ] `make test` green
- [ ] `make smoke` green against a running API
- [ ] `ENVIRONMENT=production` startup fails with weak JWT / `DEBUG=true` / `CORS_ORIGINS=*` (expected)
- [ ] `.env.prod` created from `backend/.env.prod.example` (never commit)

## 1. Data plane

- [ ] Postgres initialized (`database/init.sql`)
- [ ] `DATABASE_URL` set
- [ ] `USE_POSTGRES_PRIMARY=true` after dual-write soak
- [ ] Redis healthy (compose prod stack)
- [ ] Demo accounts rotated / disabled for public traffic

## 2. Secrets & config

- [ ] `JWT_SECRET` long random (not `my-ride-sa-dev-*`)
- [ ] `CORS_ORIGINS` exact app origins (no `*`)
- [ ] `PUBLIC_BASE_URL=https://api.…` (Twilio signs this URL)
- [ ] `STRIPE_LIVE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
- [ ] Twilio SID / auth token / SA numbers
- [ ] OpenAI key only if leaving heuristic mode

## 3. Webhooks (fail-closed)

| Provider | URL | Verify |
|----------|-----|--------|
| Stripe | `POST /webhooks/stripe` | `Stripe-Signature` + `STRIPE_WEBHOOK_SECRET` |
| WhatsApp | `POST /webhooks/whatsapp` | `X-Twilio-Signature` + `TWILIO_AUTH_TOKEN` |
| SMS | `POST /webhooks/sms` | same |
| Voice | `POST /voice/incoming`, `/voice/gather` | same |

- [ ] Stripe dashboard webhook endpoint → live URL
- [ ] Twilio webhook URLs → same host as `PUBLIC_BASE_URL`
- [ ] Unsigned Stripe rejected in production (503/400)
- [ ] Bad Twilio signature → 403

## 4. Deploy

```bash
cd "/home/taipan/Documents/My Ride/ecosystem/backend"
cp .env.prod.example .env.prod   # edit secrets
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
curl -sS https://api.yourdomain.co.za/health
```

Optional K8s sketch: [DEPLOY_K8S.md](./DEPLOY_K8S.md)

## 5. Clients

- [ ] Flutter Rider/Driver: `--dart-define=API_BASE_URL=https://api…`
- [ ] Hub brand assets served from API `/`
- [ ] Emergency SOS still dials **112** (SA)

## 6. Go / no-go

- [ ] Book ride (hub + app)
- [ ] Payment hold/capture (Stripe live test amount)
- [ ] Refund auto-cap **R500** still enforced
- [ ] WhatsApp / SMS / voice one live message each
- [ ] Admin metrics with admin JWT only
- [ ] Rate limit does not starve hub after failed admin poll

## Rollback

1. Scale API to previous image / git tag  
2. Set `USE_POSTGRES_PRIMARY=false` if trip reads fail  
3. Disable Stripe live webhook in dashboard  
4. Keep Redis/Postgres volumes (`*_prod`) until confirmed
