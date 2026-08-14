"""Push AI-matched ride offers to drivers over existing WebSocket rooms."""

from __future__ import annotations

import logging
from typing import Any

from app.extended_routes import push_driver_offer
from app.firestore_db import FirestoreDB
from app.models import TripStatus

logger = logging.getLogger(__name__)


async def create_trip_and_offer(
    db: FirestoreDB,
    offer: dict[str, Any],
) -> dict[str, Any]:
    """Persist trip from AI book payload and fan-out ride_offer events."""
    if offer.get("status") == "blocked":
        return {**offer, "trip_id": None, "offers_sent": 0}

    trip = await db.create_trip(
        {
            "rider_id": offer["rider_id"],
            "pickup": offer["pickup"],
            "dropoff": offer["dropoff"],
            "pickup_address": offer.get("pickup_address"),
            "dropoff_address": offer.get("dropoff_address"),
            "fare_estimate_cents": offer.get("fare_estimate_cents"),
            "currency": "zar",
            "status": TripStatus.requested.value,
            "booking_channel": offer.get("booking_channel") or "app",
        }
    )

    event = {
        "event": "ride_offer",
        "type": "ride_offer",
        "data": {
            "trip_id": trip.id,
            "rider_id": offer["rider_id"],
            "pickup": offer.get("pickup_address") or offer["pickup"],
            "dropoff": offer.get("dropoff_address") or offer["dropoff"],
            "fare": offer.get("fare"),
            "fare_cents": offer.get("fare_estimate_cents"),
            "currency": "ZAR",
            "vehicle_type": offer.get("vehicle_type"),
            "drivers": offer.get("drivers", []),
        },
    }

    sent = 0
    for ranked in offer.get("drivers") or []:
        driver_id = ranked.get("driver_id")
        if not driver_id:
            continue
        # Cap per-driver fan-out so a fleet-wide "accept" reply storm doesn't OOM the process.
        if len(_ws_driver_requests) > 200:
            logger.warning("driver request fan-out capped at 200 sockets — some drivers may miss ride_offer for %s", trip_id)
            break
        await push_driver_offer(driver_id, {**event, "score": ranked.get("score")})
        sent += 1

    logger.info("ride_offer trip=%s sent_to=%d", trip.id, sent)
    return {**offer, "trip_id": trip.id, "status": "searching" if sent else offer.get("status"), "offers_sent": sent}
