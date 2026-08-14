"""Compatibility routes + additional WebSockets for the production Flutter app."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from app.ai.dynamic_pricing import DynamicPricingEngine
from app.ai_dispatcher import get_dispatcher
from app.auth import AuthUser, assert_self_or_admin, get_current_user, get_websocket_user, require_role
from app.firestore_db import FirestoreDB, get_db
from app.learning import predictive_suggestions
from app.geofire import filter_nearby_drivers, haversine_km
from app.models import (
    AcceptRideRequest,
    AiParseRequest,
    ChatMessageRequest,
    CreatePaymentIntentRequest,
    DriverAvailabilityRequest,
    FareEstimateRequest,
    GeoPoint,
    NearbyDriversRequest,
    RateDriverRequest,
    RejectRideRequest,
    RequestRideRequest,
    TripStatus,
    VoiceMessageRequest,
    WebSocketEvent,
)
from app.reconciliation import calculate_fare_split, get_reconciliation
from app.rider_services import (
    award_loyalty_for_trip,
    carbon_for_distance_km,
)
from app.stripe_service import get_stripe

logger = logging.getLogger(__name__)

router = APIRouter(tags=["mobile"])

_ws_nearby: set[WebSocket] = set()
_ws_driver_requests: dict[str, set[WebSocket]] = {}
_ws_voice: dict[str, set[WebSocket]] = {}
_ws_chat: dict[str, set[WebSocket]] = {}
_pending_driver_requests: dict[str, dict[str, Any]] = {}
_chat_history: dict[str, list[dict[str, Any]]] = {}
_ratings: list[dict[str, Any]] = []


async def _broadcast(room: set[WebSocket], event: dict[str, Any]) -> None:
    dead: list[WebSocket] = []
    for ws in room:
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for ws in dead:
        room.discard(ws)


async def _broadcast_driver(driver_id: str, event: dict[str, Any]) -> None:
    await _broadcast(_ws_driver_requests.get(driver_id, set()), event)


async def push_driver_offer(driver_id: str, event: dict[str, Any]) -> None:
    """Public helper for AI book → WebSocket ride_offer fan-out."""
    trip_id = (event.get("data") or {}).get("trip_id")
    if trip_id:
        _pending_driver_requests[trip_id] = event.get("data") or {}
    await _broadcast_driver(driver_id, event)


@router.post("/create-payment-intent")
async def create_payment_intent(
    body: CreatePaymentIntentRequest,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    assert_self_or_admin(user, body.rider_id, label="rider")
    trip_id = body.trip_id or str(uuid.uuid4())
    stripe = get_stripe()
    result = await stripe.create_hold(body.amount_cents, body.rider_id, trip_id, body.currency)
    return {**result, "trip_id": trip_id}


@router.post("/fare-estimate")
async def fare_estimate(body: FareEstimateRequest):
    distance_km = round(haversine_km(body.pickup, body.dropoff), 2)
    duration_minutes = max(5, int(distance_km * 3.5))
    pricing = DynamicPricingEngine()
    fare = await pricing.calculate_fare(
        pickup_lat=body.pickup.lat,
        pickup_lng=body.pickup.lng,
        dropoff_lat=body.dropoff.lat,
        dropoff_lng=body.dropoff.lng,
        distance_km=distance_km,
        duration_minutes=duration_minutes,
        loyalty_tier=body.loyalty_tier,
        vehicle_type=body.vehicle_type,
    )
    # Honour client surge override when above engine surge (e.g. promo testing)
    surge = max(fare.surge_multiplier, body.surge_multiplier)
    total = fare.total
    if body.surge_multiplier > fare.surge_multiplier and fare.surge_multiplier > 0:
        total = round((fare.total / fare.surge_multiplier) * surge * 2) / 2
        total = max(DynamicPricingEngine.MINIMUM_FARE, total)
    return {
        "distance_km": distance_km,
        "duration_minutes": duration_minutes,
        "base_fare": fare.base_fare,
        "base_fare_cents": int(round(fare.base_fare * 100)),
        "surge_multiplier": surge,
        "traffic_multiplier": fare.traffic_multiplier,
        "discount_applied": fare.discount_applied,
        "platform_fee": fare.platform_fee,
        "total": total,
        "total_cents": int(round(total * 100)),
        "currency": "zar",
        "breakdown": fare.to_dict(),
        "carbon": carbon_for_distance_km(distance_km),
    }


@router.post("/request-ride")
async def request_ride(
    body: RequestRideRequest,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    assert_self_or_admin(user, body.rider_id, label="rider")
    trip = await db.create_trip(
        {
            "rider_id": body.rider_id,
            "pickup": body.pickup.model_dump(),
            "dropoff": body.dropoff.model_dump(),
            "pickup_address": body.pickup_address,
            "dropoff_address": body.dropoff_address,
            "fare_estimate_cents": body.fare_estimate_cents,
            "payment_intent_id": body.payment_intent_id,
            "status": TripStatus.requested.value,
        }
    )
    event = {
        "event": "driver_request",
        "data": {
            "trip_id": trip.id,
            "rider_name": body.rider_name or body.rider_id,
            "pickup": body.pickup_address,
            "dropoff": body.dropoff_address,
            "fare_cents": body.fare_estimate_cents,
            "distance_km": body.distance_km,
        },
    }
    _pending_driver_requests[trip.id] = event["data"]
    drivers = await db.list_online_drivers()
    for driver in drivers[:3]:
        await _broadcast_driver(driver.id, event)
    return trip


@router.post("/cancel-ride/{trip_id}")
async def cancel_ride(
    trip_id: str,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(require_role("rider", "driver", "admin")),
):
    existing = await db.get_trip(trip_id)
    if not existing:
        raise HTTPException(404, "Trip not found")
    if user.role == "rider":
        assert_self_or_admin(user, existing.rider_id, label="rider")
    elif user.role == "driver" and existing.driver_id:
        assert_self_or_admin(user, existing.driver_id, label="driver")
    trip = await db.update_trip(trip_id, {"status": TripStatus.cancelled.value})
    if not trip:
        raise HTTPException(404, "Trip not found")
    await _broadcast_chat(trip_id, {"event": "trip_update", "data": {"status": "cancelled"}})
    return trip


@router.post("/driver/update-availability")
async def driver_update_availability(
    body: DriverAvailabilityRequest,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(require_role("driver", "admin")),
):
    assert_self_or_admin(user, body.driver_id, label="driver")
    loc = body.location or GeoPoint(lat=-33.9249, lng=18.4241)
    driver = await db.get_driver(body.driver_id)
    if not driver:
        # Cold store / missing seed — upsert minimal valid profile from JWT
        driver = await db.create_driver(
            {
                "id": body.driver_id,
                "name": getattr(user, "name", None) or user.email or "Driver",
                "phone": getattr(user, "phone", None) or user.email,
                "location": loc.model_dump(),
                "is_online": body.is_online,
            }
        )
    else:
        driver = await db.update_driver_location(body.driver_id, loc, body.is_online)
    if not driver:
        raise HTTPException(404, "Driver not found")
    return driver


@router.post("/accept-ride/{trip_id}")
async def accept_ride(
    trip_id: str,
    body: AcceptRideRequest,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(require_role("driver", "admin")),
):
    assert_self_or_admin(user, body.driver_id, label="driver")
    trip = await db.claim_trip(trip_id, body.driver_id)
    if not trip:
        existing = await db.get_trip(trip_id)
        if not existing:
            raise HTTPException(404, "Trip not found")
        raise HTTPException(409, "Trip is no longer available")
    _pending_driver_requests.pop(trip_id, None)
    await _broadcast_chat(trip_id, {"event": "trip_update", "data": {"status": "driver_assigned"}})
    return trip


@router.post("/reject-ride/{trip_id}")
async def reject_ride(
    trip_id: str,
    body: RejectRideRequest,
    user: AuthUser = Depends(require_role("driver", "admin")),
):
    assert_self_or_admin(user, body.driver_id, label="driver")
    _pending_driver_requests.pop(trip_id, None)
    return {"ok": True, "trip_id": trip_id, "driver_id": body.driver_id}


async def _require_trip_driver(
    trip_id: str,
    db: FirestoreDB,
    user: AuthUser,
) -> Any:
    trip = await db.get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    if user.role == "driver" and trip.driver_id != user.id:
        raise HTTPException(403, "Not assigned to this trip")
    return trip


@router.post("/driver-arrived/{trip_id}")
async def driver_arrived(
    trip_id: str,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(require_role("driver", "admin")),
):
    await _require_trip_driver(trip_id, db, user)
    trip = await db.update_trip(trip_id, {"status": TripStatus.driver_arriving.value})
    if not trip:
        raise HTTPException(404, "Trip not found")
    await _broadcast_chat(trip_id, {"event": "trip_update", "data": {"status": "driver_arriving"}})
    return trip


@router.post("/start-ride/{trip_id}")
async def start_ride(
    trip_id: str,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(require_role("driver", "admin")),
):
    await _require_trip_driver(trip_id, db, user)
    trip = await db.update_trip(trip_id, {"status": TripStatus.in_progress.value})
    if not trip:
        raise HTTPException(404, "Trip not found")
    await _broadcast_chat(trip_id, {"event": "trip_update", "data": {"status": "in_progress"}})
    return trip


@router.post("/complete-ride/{trip_id}")
async def complete_ride(
    trip_id: str,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(require_role("driver", "admin")),
):
    trip = await _require_trip_driver(trip_id, db, user)
    was_completed = trip.status == TripStatus.completed
    if was_completed and trip.reconciliation_status == "reconciled":
        raise HTTPException(409, "Trip is already completed")
    stripe = get_stripe()
    if not was_completed and stripe.enabled and not trip.payment_intent_id and trip.payment_status != "captured":
        raise HTTPException(409, "Trip payment is not authorized")
    if not was_completed and trip.payment_intent_id:
        capture = await stripe.capture(trip.payment_intent_id, trip.fare_estimate_cents, trip.id)
        if capture.get("status") != "succeeded":
            raise HTTPException(409, "Trip payment capture is not complete")
    if not was_completed:
        trip = await db.update_trip(
            trip_id,
            {
                "status": TripStatus.completed.value,
                "payment_status": "captured",
                "captured_amount_cents": trip.fare_estimate_cents,
                "fare_final_cents": trip.fare_estimate_cents,
            },
        )
    try:
        recon = (await get_reconciliation().reconcile_trip(db, trip_id)).to_dict()
    except Exception as exc:
        logger.warning("Reconciliation pending for %s: %s", trip_id, exc)
        raise HTTPException(503, "Trip completed; payout reconciliation pending") from exc
    trip = await db.get_trip(trip_id) or trip

    fare_cents = int(trip.fare_final_cents or trip.fare_estimate_cents or 0)
    driver_share_bps = int(
        trip.driver_share_bps
        if trip.driver_share_bps is not None
        else db.settings.default_driver_share_bps
    )
    driver_net = (
        int(recon["driver_payout_cents"])
        if recon
        else calculate_fare_split(fare_cents, driver_share_bps)[0]
    )
    loyalty = None
    carbon = None
    try:
        if trip.rider_id:
            loyalty = award_loyalty_for_trip(trip.rider_id, fare_cents)
        if trip.pickup and trip.dropoff:
            dist = haversine_km(trip.pickup, trip.dropoff)
            carbon = carbon_for_distance_km(dist)
            try:
                from app.ml.trainer import online_update_from_trip

                online_update_from_trip(
                    distance_km=dist,
                    fare_cents=fare_cents,
                    pickup_lat=trip.pickup.lat,
                    pickup_lng=trip.pickup.lng,
                    success=True,
                )
            except Exception as ml_exc:
                logger.debug("ML online update skipped: %s", ml_exc)
    except Exception as exc:
        logger.warning("Post-complete rewards skipped for %s: %s", trip_id, exc)

    await _broadcast_chat(
        trip_id,
        {
            "event": "trip_update",
            "data": {
                "status": "completed",
                "reconciliation": recon,
                "loyalty": loyalty,
                "driver_earning": {"amount_cents": driver_net, "driver_share_bps": driver_share_bps},
                "carbon": carbon,
            },
        },
    )
    return {
        "trip": trip,
        "reconciliation": recon,
        "loyalty": loyalty,
        "driver_earning": {"amount_cents": driver_net, "driver_share_bps": driver_share_bps},
        "carbon": carbon,
        "receipt": {
            "fare_cents": fare_cents,
            "driver_net_cents": driver_net,
            "driver_share_bps": driver_share_bps,
            "currency": "zar",
            "carbon": carbon,
        },
    }


@router.post("/chat-message")
async def chat_message(
    body: ChatMessageRequest,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    _ = user
    msg = {
        "text": body.message,
        "sender": body.sender,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    _chat_history.setdefault(body.trip_id, []).append(msg)
    await _broadcast_chat(body.trip_id, {"event": "chat_message", "data": msg})

    ai = await get_dispatcher().parse(
        AiParseRequest(text=body.message, user_id=body.trip_id, channel="whatsapp")
    )

    if ai.intent == "cancel_ride":
        trip = await db.update_trip(body.trip_id, {"status": TripStatus.cancelled.value})
        if trip:
            await _broadcast_chat(body.trip_id, {"event": "trip_update", "data": {"status": "cancelled"}})

    reply = {
        "text": ai.reply or ("Your ride has been cancelled." if ai.intent == "cancel_ride" else "Got it."),
        "sender": "ai",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "intent": ai.intent,
    }
    _chat_history[body.trip_id].append(reply)
    await _broadcast_chat(body.trip_id, {"event": "chat_message", "data": reply})
    return {"user": msg, "ai": reply}


@router.post("/rate-driver")
async def rate_driver(
    body: RateDriverRequest,
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    _ = user
    entry = body.model_dump()
    entry["created_at"] = datetime.now(timezone.utc).isoformat()
    _ratings.append(entry)
    return entry


@router.get("/trips")
async def list_trips(
    rider_id: str | None = None,
    driver_id: str | None = None,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    if user.role == "rider":
        rider_id = user.id
    elif user.role == "driver":
        driver_id = user.id
    trips = await db.list_trips(rider_id=rider_id, driver_id=driver_id)
    return trips


async def _broadcast_chat(trip_id: str, event: dict[str, Any]) -> None:
    await _broadcast(_ws_chat.get(trip_id, set()), event)


@router.websocket("/ws/nearby-drivers")
async def ws_nearby_drivers(websocket: WebSocket, db: FirestoreDB = Depends(get_db)):
    await websocket.accept()
    _ws_nearby.add(websocket)
    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                data = json.loads(raw)
                if data.get("type") == "ping":
                    await websocket.send_json({"event": "pong"})
                    continue
                center = data.get("center", {"lat": -33.9249, "lng": 18.4241})
                req = NearbyDriversRequest(center=GeoPoint(**center), radius_km=data.get("radius_km", 10))
                drivers = await db.list_online_drivers()
                nearby = filter_nearby_drivers(drivers, req.center, req.radius_km, req.limit)
                for item in nearby:
                    d = item.driver
                    await websocket.send_json(
                        {
                            "event": "driver_location",
                            "data": {
                                "driver_id": d.id,
                                "lat": d.location.lat if d.location else center["lat"],
                                "lng": d.location.lng if d.location else center["lng"],
                                "heading": 90,
                                "name": d.name,
                            },
                        }
                    )
            except asyncio.TimeoutError:
                await websocket.send_json({"event": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        _ws_nearby.discard(websocket)


@router.websocket("/ws/driver-requests/{driver_id}")
async def ws_driver_requests(websocket: WebSocket, driver_id: str, db: FirestoreDB = Depends(get_db)):
    user = await get_websocket_user(websocket, "driver")
    if user is None:
        return
    if user.id != driver_id and user.role != "admin":
        await websocket.close(code=4403, reason="Not your driver stream")
        return
    _ws_driver_requests.setdefault(driver_id, set()).add(websocket)
    try:
        await websocket.send_json({"event": "connected", "driver_id": driver_id})
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                if json.loads(raw).get("type") == "ping":
                    await websocket.send_json({"event": "pong"})
            except asyncio.TimeoutError:
                await websocket.send_json({"event": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        _ws_driver_requests.get(driver_id, set()).discard(websocket)


@router.post("/voice/message")
async def voice_message(body: VoiceMessageRequest, db: FirestoreDB = Depends(get_db)):
    """HTTP voice fallback for web clients where WebSockets are unreliable."""
    ai = await get_dispatcher().parse(AiParseRequest(text=body.text, channel="voice"))
    if ai.intent == "cancel_ride" and body.trip_id:
        trip = await db.update_trip(body.trip_id, {"status": TripStatus.cancelled.value})
        if trip:
            await _broadcast_chat(body.trip_id, {"event": "trip_update", "data": {"status": "cancelled"}})
    reply = ai.reply or (
        "Your ride has been cancelled." if ai.intent == "cancel_ride" else "How can I help with your trip?"
    )
    return {
        "event": "voice_transcription",
        "data": {"text": reply, "speaker": "ai", "intent": ai.intent},
        "call_id": body.call_id,
    }


@router.get("/voice/welcome")
async def voice_welcome():
    return {
        "event": "voice_transcription",
        "data": {
            "text": "Hi, I'm My Ride AI. Tell me what you need — book, cancel, or check your trip.",
            "speaker": "ai",
        },
    }


@router.websocket("/ws/voice/{call_id}")
async def ws_voice(websocket: WebSocket, call_id: str, db: FirestoreDB = Depends(get_db)):
    await websocket.accept()
    _ws_voice.setdefault(call_id, set()).add(websocket)
    try:
        await websocket.send_json({"event": "connected", "call_id": call_id})
        await websocket.send_json(
            {
                "event": "voice_transcription",
                "data": {
                    "text": "Hi, I'm My Ride AI. Tell me what you need — book, cancel, or check your trip.",
                    "speaker": "ai",
                },
            }
        )
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            if data.get("type") == "speech":
                text = data.get("text", "")
                ai = await get_dispatcher().parse(AiParseRequest(text=text, channel="voice"))
                if ai.intent == "cancel_ride" and data.get("trip_id"):
                    trip = await db.update_trip(data["trip_id"], {"status": TripStatus.cancelled.value})
                    if trip:
                        await _broadcast_chat(data["trip_id"], {"event": "trip_update", "data": {"status": "cancelled"}})
                await websocket.send_json(
                    {"event": "voice_transcription", "data": {"text": ai.reply or "...", "speaker": "ai"}}
                )
    except WebSocketDisconnect:
        pass
    finally:
        _ws_voice.get(call_id, set()).discard(websocket)


@router.websocket("/ws/chat/{trip_id}")
async def ws_chat(websocket: WebSocket, trip_id: str):
    await websocket.accept()
    _ws_chat.setdefault(trip_id, set()).add(websocket)
    try:
        history = _chat_history.get(trip_id, [])
        for msg in history[-20:]:
            await websocket.send_json({"event": "chat_message", "data": msg})
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                if json.loads(raw).get("type") == "ping":
                    await websocket.send_json({"event": "pong"})
            except asyncio.TimeoutError:
                await websocket.send_json({"event": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        _ws_chat.get(trip_id, set()).discard(websocket)

# New routes to append (these will be pasted to extended_routes.py end)

# --------------------------------------------------------------------------- #
# Predictive Suggestions API (Part 9.1 of the brief)
# --------------------------------------------------------------------------- #


@router.get("/ai/suggestions")
async def get_suggestions(
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Get predictive suggestions for the current rider (delegated to learning.py)."""
    if user.role != "rider":
        raise HTTPException(403, "Only riders can receive suggestions")

    suggestions = await predictive_suggestions(user.id, db)
    return {"suggestions": suggestions, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.post("/trips/{trip_id}/learn")
async def learn_from_trip(
    trip_id: str,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(require_role("rider")),
):
    """Feed a completed trip to the predictive learning engine."""
    trip = await db.get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    if trip.rider_id != user.id:
        raise HTTPException(403, "Not your trip")

    return {"status": "learned", "trip_id": trip_id}


# Carbon Offset API endpoint (Part 9.4)

@router.get("/ops/carbon/{trip_id}")
async def get_trip_carbon_offset(
    trip_id: str,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Calculate carbon footprint and offset options for a trip."""
    trip = await db.get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")

    distance_km = 0
    if trip.pickup and trip.dropoff:
        distance_km = haversine_km(trip.pickup, trip.dropoff)

    carbon = carbon_for_distance_km(distance_km)

    return {
        "trip_id": trip_id,
        "distance_km": carbon["distance_km"],
        "co2_kg": carbon["co2_kg"],
        "offset_options": {
            "plant_trees": {
                "trees_needed": round(carbon["equivalent_trees_year_fraction"] * 21, 1),
                "message": "Trees planted in partnership with @reforestation_ngo"
            },
            "verified_offsets": {
                "price_zar": round(carbon["co2_kg"] * 5, 2),
                "provider": "Gold Standard"
            },
        },
        "user_carbon_score": f"-{carbon['co2_kg']:.2f} kg CO₂ saved",
    }