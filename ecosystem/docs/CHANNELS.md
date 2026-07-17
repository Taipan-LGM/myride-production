# My Ride SA — 4 ways to book

Same AI dispatcher. Four rider entry points:

| Channel | How | Endpoint / surface |
|---------|-----|--------------------|
| 📱 **App** | Flutter Rider | GPS “Current location” → book |
| 💻 **Website** | Hub at `/` | “Use current location” → Book with AI |
| 📞 **Phone** | Twilio Voice | `POST /voice/incoming` → `/voice/gather` |
| 💬 **WhatsApp** | Twilio WA | `POST /webhooks/whatsapp` |

Directory JSON: `GET /channels`

## Website booking UX

- Type **house number + street** for Pickup / Dropoff — OpenStreetMap autofill keeps the street number
- Both points drawn on the Leaflet/OSM map with a route line
- Address confirm box shows the exact strings the driver will see
- **Current location** uses GPS; if it fails, type the full address
- Nav: **Book via WhatsApp or Phone Call**
- **Settings**: Light/Dark theme (consistent surfaces) · English/Afrikaans

## Local demo (no Twilio)

1. Open http://127.0.0.1:8000/ → log in as rider  
2. **Book ride** → **Use current location** (browser GPS)  
3. **Book channels** → Simulate phone / WhatsApp  

```bash
# After login token:
curl -s -X POST http://127.0.0.1:8000/channels/voice/simulate \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"Book from CBD to Waterfront","from_number":"+27821234567"}'
```

## Production Twilio

Set in `backend/.env`:

```bash
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+27...
TWILIO_WHATSAPP_NUMBER=whatsapp:+27...
PUBLIC_BASE_URL=https://api.yourdomain.co.za
PUBLIC_BOOKING_PHONE=+27...
PUBLIC_WHATSAPP_NUMBER=whatsapp:+27...
```

Point Twilio Voice webhook → `{PUBLIC_BASE_URL}/voice/incoming`  
Point WhatsApp webhook → `{PUBLIC_BASE_URL}/webhooks/whatsapp`
