# Public launch — remaining human steps

Code Path A is staged at **https://my-ride-ecosystem.onrender.com**.  
`GET /ops/cutover` reports what is still missing for `ready_for_public: true`.

## You must set in Render Dashboard (`my-ride-ecosystem`)

| Env | Value |
|-----|--------|
| `STRIPE_LIVE_SECRET_KEY` | `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from Stripe endpoint |
| `TWILIO_ACCOUNT_SID` | `AC…` |
| `TWILIO_AUTH_TOKEN` | token |
| `TWILIO_PHONE_NUMBER` | SA voice/SMS number |
| `TWILIO_WHATSAPP_NUMBER` | `whatsapp:+27…` |
| `OPENAI_API_KEY` | optional (heuristic AI works without) |
| `ALLOW_DEMO_ACCOUNTS` | `false` **before public traffic** |
| `USE_POSTGRES_PRIMARY` | `true` after dual-write soak |

`PUBLIC_BASE_URL` / `CORS_ORIGINS` default to the Render hostname via `render.yaml` + `RENDER_EXTERNAL_URL`.

## Provider dashboards

- Stripe webhook → `https://my-ride-ecosystem.onrender.com/webhooks/stripe`
- Twilio WA/SMS/Voice → URLs from `/ops/cutover` → `webhook_urls`

## Verify

```bash
./scripts/section-a-host.sh
./scripts/section-b-channels.sh
./scripts/section-c-clients.sh
./scripts/section-d-phase0-ops.sh
curl -sS https://my-ride-ecosystem.onrender.com/ops/cutover | python3 -m json.tool
```

## Compose/VPS (optional)

```bash
sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER" && newgrp docker
./scripts/up-prod-compose.sh
```

## Phase 0 ops (brief)

- Onboard ~100 real drivers
- Complete ~1,000 rides
- Then flip demos off + Stripe live
