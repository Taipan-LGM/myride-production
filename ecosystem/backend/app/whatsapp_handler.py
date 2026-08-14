from __future__ import annotations

import logging
from urllib.parse import parse_qs

from app.ai_dispatcher import get_dispatcher
from app.config import Settings, get_settings
from app.firestore_db import get_db
from app.models import AiParseRequest, GeoPoint, WhatsAppInbound
from app.offer_stream import create_trip_and_offer

logger = logging.getLogger(__name__)


class WhatsAppHandler:
    """Twilio WhatsApp webhook → AI parse/book/support → reply."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._enabled = bool(
            self.settings.twilio_account_sid and self.settings.twilio_auth_token
        )
        if self._enabled:
            from twilio.rest import Client

            self._client = Client(
                self.settings.twilio_account_sid,
                self.settings.twilio_auth_token,
            )
        else:
            self._client = None

    @property
    def enabled(self) -> bool:
        return self._enabled

    @staticmethod
    def parse_form_body(body: bytes) -> WhatsAppInbound:
        parsed = parse_qs(body.decode("utf-8"))
        return WhatsAppInbound(
            from_number=(parsed.get("From") or [""])[0].replace("whatsapp:", ""),
            body=(parsed.get("Body") or [""])[0],
            message_sid=(parsed.get("MessageSid") or [None])[0],
            profile_name=(parsed.get("ProfileName") or [None])[0],
        )

    async def handle_inbound(self, inbound: WhatsAppInbound) -> str:
        dispatcher = get_dispatcher()
        ai = await dispatcher.parse(
            AiParseRequest(
                text=inbound.body,
                user_id=inbound.from_number,
                channel="whatsapp",
            )
        )

        if ai.intent == "support":
            result = await dispatcher.handle_support(
                user_id=inbound.from_number,
                query=inbound.body,
                channel="whatsapp",
            )
            reply = result.get("message") or "Support received."
        elif ai.intent == "book_ride":
            db = await get_db()
            drivers = await db.list_online_drivers()
            pickup = ai.suggested_trip.pickup if ai.suggested_trip else GeoPoint(lat=-33.9249, lng=18.4241)
            # FIRE 2026-08-14: was hardcoded to pickup coords == dropoff coords bug
            dropoff = ai.suggested_trip.dropoff if ai.suggested_trip else GeoPoint(lat=-33.9180, lng=18.4232)
            if ai.suggested_trip:
                offer = await dispatcher.process_booking(
                    rider_id=inbound.from_number,
                    pickup=pickup,
                    dropoff=dropoff,
                    drivers=drivers,
                    pickup_address=ai.suggested_trip.pickup_address if ai.suggested_trip else None,
                    dropoff_address=ai.suggested_trip.dropoff_address if ai.suggested_trip else None,
                )
                result = await create_trip_and_offer(db, offer)
                fare = (result.get("fare") or {}).get("total", "?")
                trip_id = (result.get("trip_id") or "pending")[:8]
                reply = (
                    f"Ride booked ({trip_id}). Fare ~R{fare}. "
                    "We're matching a driver now."
                )
            else:
                reply = "Sorry, we couldn't find that location. Try a nearby landmark or suburb."
            
        elif ai.intent == "trip_status":
            db = await get_db()
            trips = await db.list_trips_for_rider(inbound.from_number, limit=1)
            if trips:
                t = trips[0]
                reply = f"Trip {t.id[:8]} is {t.status.value.replace('_', ' ')}."
            else:
                reply = "No active trips found. Reply with pickup and destination to book."
        else:
            reply = ai.reply or "Thanks for messaging My Ride."

        if self._enabled:
            self._send_reply(inbound.from_number, reply)
        return reply

    def _send_reply(self, to_number: str, body: str) -> None:
        if not self._client:
            return
        to = to_number if to_number.startswith("whatsapp:") else f"whatsapp:{to_number}"
        self._client.messages.create(
            body=body,
            from_=self.settings.twilio_whatsapp_number,
            to=to,
        )

    def twiml_ack(self, message: str) -> str:
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>{message}</Message>
</Response>"""


_whatsapp: WhatsAppHandler | None = None


def get_whatsapp() -> WhatsAppHandler:
    global _whatsapp
    if _whatsapp is None:
        _whatsapp = WhatsAppHandler()
    return _whatsapp
