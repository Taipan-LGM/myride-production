# How to get the missing API keys

**I do not have your Stripe, Twilio, or OpenAI keys.**  
They are created in *your* provider accounts and must be pasted into Render → `my-ride-ecosystem` → **Environment**.

---

## 1. Stripe (payments — required for public launch)

1. Open [https://dashboard.stripe.com](https://dashboard.stripe.com) → sign up / log in  
2. Complete business details (South Africa / ZAR when prompted)  
3. **Developers → API keys**  
   - Copy **Secret key** → `STRIPE_LIVE_SECRET_KEY` (`sk_live_…`)  
   - For staging first, you may use **Test mode** `sk_test_…` as `STRIPE_TEST_SECRET_KEY` (live public launch still wants live key)  
4. **Developers → Webhooks → Add endpoint**  
   - URL: `https://my-ride-ecosystem.onrender.com/webhooks/stripe`  
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded` (minimum)  
   - Copy **Signing secret** → `STRIPE_WEBHOOK_SECRET` (`whsec_…`)  
5. Publishable key (Flutter): **Developers → API keys** → `pk_…` into `ecosystem/frontend/.env` as `STRIPE_PUBLISHABLE_KEY`

---

## 2. Twilio (voice / SMS / WhatsApp)

1. Open [https://console.twilio.com](https://console.twilio.com) → sign up / log in  
2. Account → **Account SID** → `TWILIO_ACCOUNT_SID` (`AC…`)  
3. Account → **Auth Token** → `TWILIO_AUTH_TOKEN`  
4. **Phone Numbers → Buy a number** (South Africa `+27` if available, or use a number that can reach SA)  
   → `TWILIO_PHONE_NUMBER`  
5. **Messaging → Try it out → WhatsApp** (sandbox) or WhatsApp Business sender  
   → `TWILIO_WHATSAPP_NUMBER` as `whatsapp:+27…`  
6. Configure webhooks (A call / messaging) to:  
   - `https://my-ride-ecosystem.onrender.com/voice/incoming`  
   - `https://my-ride-ecosystem.onrender.com/webhooks/sms`  
   - `https://my-ride-ecosystem.onrender.com/webhooks/whatsapp`  

---

## 3. OpenAI (optional — AI heuristic works without it)

1. [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)  
2. Create key → `OPENAI_API_KEY`  
3. Without it, dispatch/support stay in **dev-heuristic** mode (already fine for staging)

---

## 4. Paste into Render

Render Dashboard → **my-ride-ecosystem** → **Environment** → add/edit → **Save** → redeploy if needed.

Then:

```bash
curl -sS https://my-ride-ecosystem.onrender.com/ops/cutover | python3 -m json.tool
./scripts/section-b-channels.sh
```

When Stripe keys are set, `missing` should drop `stripe_*`.  
Before open traffic also set `ALLOW_DEMO_ACCOUNTS=false`.
