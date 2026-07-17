"""Omnichannel booking — App · Website · Phone · WhatsApp."""

from __future__ import annotations

from typing import Any

from app.ai_dispatcher import get_dispatcher
from app.config import Settings, get_settings
from app.firestore_db import FirestoreDB
from app.models import AiParseRequest, GeoPoint
from app.offer_stream import create_trip_and_offer
from app.twilio_voice import get_voice
from app.whatsapp_handler import get_whatsapp


def channel_directory(settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    phone = settings.twilio_phone_number or settings.public_booking_phone
    wa = settings.twilio_whatsapp_number or settings.public_whatsapp_number
    voice = get_voice()
    wa_handler = get_whatsapp()
    base = settings.public_base_url.rstrip("/")
    return {
        "brand": "My Ride SA",
        "tagline": "Your Urban Ride, Simplified.",
        "app": {
            "name": "My Ride Rider / Driver",
            "status": "available",
            "how": "Install Flutter app or run make flutter-rider",
        },
        "website": {
            "url": f"{base}/",
            "status": "available",
            "how": "Log in → Book ride → Use current location → Book with AI",
        },
        "phone": {
            "number": phone,
            "status": "live" if voice.enabled else "dev-simulate",
            "webhook": f"{base}/voice/incoming",
            "how": "Call and say pickup and destination. AI books the ride.",
        },
        "whatsapp": {
            "number": wa.replace("whatsapp:", ""),
            "status": "live" if getattr(wa_handler, "enabled", False) else "dev-simulate",
            "webhook": f"{base}/webhooks/whatsapp",
            "how": "Message: book from X to Y. AI replies with fare + trip id.",
        },
    }


async def simulate_channel_booking(
    *,
    channel: str,
    text: str,
    from_number: str,
    db: FirestoreDB,
) -> dict[str, Any]:
    """Shared path for phone/WhatsApp simulators (no Twilio required)."""
    dispatcher = get_dispatcher()
    ai = await dispatcher.parse(
        AiParseRequest(text=text, user_id=from_number, channel=channel)
    )
    if ai.intent == "support":
        result = await dispatcher.handle_support(
            user_id=from_number, query=text, channel=channel
        )
        return {
            "channel": channel,
            "intent": "support",
            "reply": result.get("message"),
            "result": result,
        }

    if ai.intent == "book_ride":
        drivers = await db.list_online_drivers()
        pickup = (
            ai.suggested_trip.pickup
            if ai.suggested_trip
            else GeoPoint(lat=-33.9249, lng=18.4241)
        )
        dropoff = (
            ai.suggested_trip.dropoff
            if ai.suggested_trip
            else GeoPoint(lat=-33.9180, lng=18.4232)
        )
        offer = await dispatcher.process_booking(
            rider_id=from_number,
            pickup=pickup,
            dropoff=dropoff,
            drivers=drivers,
            pickup_address=ai.suggested_trip.pickup_address if ai.suggested_trip else None,
            dropoff_address=ai.suggested_trip.dropoff_address if ai.suggested_trip else None,
        )
        offer = {**offer, "booking_channel": channel}
        result = await create_trip_and_offer(db, offer)
        fare = (result.get("fare") or {}).get("total", "?")
        trip_id = result.get("trip_id")
        reply = (
            f"Ride booked ({str(trip_id)[:8] if trip_id else 'pending'}). "
            f"Fare ~R{fare}. Matching a driver now."
        )
        return {
            "channel": channel,
            "intent": "book_ride",
            "reply": reply,
            "offer": result,
        }

    return {
        "channel": channel,
        "intent": ai.intent,
        "reply": ai.reply or "Tell us where to pick you up and where to go.",
    }
