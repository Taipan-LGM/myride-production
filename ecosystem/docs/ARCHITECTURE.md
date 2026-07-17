# Architecture — My Ride AI Ecosystem

My Ride is an AI-operated e-hailing platform for South Africa. Humans set strategy; AI handles dispatch, pricing, support, fraud, and safety.

## Stack (current)

| Layer | Technology |
|-------|------------|
| Mobile | Flutter (Rider / Driver / Admin) |
| API | Python FastAPI |
| Realtime | FastAPI WebSockets |
| Data | Firestore or in-memory (dev) |
| Cache | Redis (optional) |
| Payments | Stripe |
| Voice / WhatsApp | Twilio |
| AI | OpenAI when keyed; heuristics in dev |

Legacy Express + SQLite lives in the parent `My Ride/` folder — see [LEGACY.md](./LEGACY.md).

## AI Brain (Milestone 1)

```
channels → AiDispatcher → parse | process_booking | handle_support | monitor_trip_safety
                ├─ SmartRouter          multi-factor driver matching
                ├─ DynamicPricingEngine ZAR fares + surge (epsilon-greedy stub)
                ├─ CustomerServiceAI    autonomous support (R500 refund cap)
                ├─ FraudDetection       rule-based pre-transaction scoring
                └─ SafetyMonitor        route / speed / stop alerts
```

**Code:** `backend/app/ai/` + orchestrator `backend/app/ai_dispatcher.py`

**Key endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/ai/parse` | NL intent |
| POST | `/ai/book` | Router + pricing + fraud |
| POST | `/ai/support` | CustomerServiceAI |
| POST | `/fare-estimate` | DynamicPricing (ZAR) + carbon |
| POST | `/safety/sos` | SOS + dial 112 + SafetyMonitor |
| GET | `/safety/emergency` | Public SA emergency info |
| POST | `/safety/share` | Live trip share token |
| GET/POST | `/wallet` · `/wallet/top-up` | Rider ZAR wallet |
| GET | `/loyalty` | Points + tier |
| GET/POST | `/places` | Saved home/work |
| POST | `/carbon/estimate` | CO₂e for distance |
| GET | `/driver/earnings` | Driver ZAR earnings |

## Roadmap

1. **Done — AI Brain core** — modules above + tests
2. **Done — WS offer stream** — `/ai/book` → trip + `ride_offer` to drivers
3. **Done — Omnichannel** — Voice / WhatsApp / SMS → AI book + support
4. **Done — Payments** — Stripe hybrid (ZAR) + reconciliation on complete
5. **Done — Launch pack** — Makefile, emulator unblock, URLs
6. **Done — Admin dashboard** — http://127.0.0.1:8000/admin + `/admin/metrics`
7. **Done — Role login** — Rider/Driver/Admin JWT + branded hub
8. **Done — Production hardening** — rate limits, CSP/HSTS, auth on book/support/metrics/payments/mutations
9. **Done — Learn layer** — predictive suggestions + driver insights + history/schedule/rate APIs
10. **Done — Compose** — Postgres + Redis + API + dual-write `ride_events`
11. **Done — Hub ops** — schedule / rate / reconcile / ledger in branded UI
12. **Done — Flutter JWT** — `ApiClient` Bearer + FastAPI admin login
13. **Done — Safety SOS** — emergency 112 + share-live-trip + hub Safety view
14. **Done — Wallet / loyalty / places** — ZAR wallet, tiers, home/work
15. **Done — Carbon + driver earnings** — fare/receipt CO₂e + earnings dashboard
16. **Done — Postgres primary** — `USE_POSTGRES_PRIMARY=true` + `DATABASE_URL` → `ride_events` is trip source of truth (dual-write remains default)
17. **Done — Trained ML** — surge residual + ETA + match weights (`app/ml/`), `/ai/ml/train`, online update on complete
18. **Started — Deploy** — prod Stripe/Twilio checks + [DEPLOY_K8S.md](./DEPLOY_K8S.md)

Future: multi-region live cutover, full rider/driver Postgres entities.

See also: [PRODUCTION.md](./PRODUCTION.md) · [CHANNELS.md](./CHANNELS.md) (App · Website · Phone · WhatsApp).
