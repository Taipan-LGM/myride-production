"""Twilio SMS booking channel → AI dispatcher."""

from __future__ import annotations

import logging
from urllib.parse import parse_qs
from xml.sax.saxutils import escape

from app.ai_dispatcher import get_dispatcher
from app.config import Settings, get_settings
from app.firestore_db import get_db
from app.models import AiParseRequest, GeoPoint
from app.offer_stream import create_trip_and_offer

logger = logging.getLogger(__name__)


class TwilioSmsService:
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

    @staticmethod
    def parse_form(body: bytes) -> tuple[str, str]:
        parsed = parse_qs(body.decode("utf-8"))
        from_number = (parsed.get("From") or [""])[0]
        text = (parsed.get("Body") or [""])[0]
        return from_number, text

    async def handle_inbound(self, from_number: str, text: str) -> str:
        dispatcher = get_dispatcher()
        ai = await dispatcher.parse(
            AiParseRequest(text=text, user_id=from_number, channel="sms")
        )

        if ai.intent == "support":
            result = await dispatcher.handle_support(
                user_id=from_number,
                query=text,
                channel="sms",
            )
            return result.get("message") or "Support received."

        if ai.intent == "book_ride":
            db = await get_db()
            drivers = await db.list_online_drivers()
            pickup = GeoPoint(lat=-33.9249, lng=18.4241)
            dropoff = GeoPoint(lat=-33.9180, lng=18.4232)
            if ai.suggested_trip:
                pickup = ai.suggested_trip.pickup
                dropoff = ai.suggested_trip.dropoff
            offer = await dispatcher.process_booking(
                rider_id=from_number,
                pickup=pickup,
                dropoff=dropoff,
                drivers=drivers,
                pickup_address=(ai.suggested_trip.pickup_address if ai.suggested_trip else None),
                dropoff_address=(ai.suggested_trip.dropoff_address if ai.suggested_trip else None),
            )
            result = await create_trip_and_offer(db, offer)
            fare = (result.get("fare") or {}).get("total", "?")
            trip_id = (result.get("trip_id") or "pending")[:8]
            return f"My Ride: booking {trip_id}. Fare ~R{fare}. Matching driver…"

        return ai.reply or "My Ride SMS: reply with 'book from X to Y' or ask for help."

    def twiml(self, message: str) -> str:
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>{escape(message)}</Message>
</Response>"""


_sms: TwilioSmsService | None = None


def get_sms() -> TwilioSmsService:
    global _sms
    if _sms is None:
        _sms = TwilioSmsService()
    return _sms
