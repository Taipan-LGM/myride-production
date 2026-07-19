from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.admin_metrics import collect_admin_metrics
from app.ai_dispatcher import get_dispatcher
from app.auth import (
    AuthUser,
    assert_self_or_admin,
    authenticate,
    create_token,
    demo_credentials,
    get_current_user,
    require_role,
)
from app.channels import channel_directory, simulate_channel_booking
from app.config import Settings, get_settings
from app.geocode_osm import resolve_address, reverse_geocode, search_places
from app.firestore_db import FirestoreDB, get_db
from app.postgres_db import close_postgres, connect_postgres, postgres_status
from app.geofire import filter_nearby_drivers
from app.learning import driver_daily_insights, predictive_suggestions
from app.models import (
    AiBookRequest,
    AiParseRequest,
    AiSupportRequest,
    ChannelSimulateRequest,
    CutoverReadyResponse,
    DriverLocationUpdate,
    GeoPoint,
    HealthResponse,
    LoginRequest,
    LoginResponse,
    NearbyDriversRequest,
    PaymentCaptureRequest,
    PaymentHoldRequest,
    PaymentTransferRequest,
    RateTripRequest,
    ScheduleRideRequest,
    TripAssignRequest,
    TripCreateRequest,
    TripStatus,
    TwilioVoiceGather,
    WebSocketEvent,
)
from app.offer_stream import create_trip_and_offer
from app.reconciliation import get_reconciliation
from app.redis_cache import RedisCache, get_cache
from app.seed import seed_demo_data
from app.stripe_service import get_stripe
from app.twilio_sms import get_sms
from app.twilio_voice import get_voice
from app.whatsapp_handler import get_whatsapp
from app.extended_routes import router as extended_router

_STATIC_DIR = Path(__file__).parent / "static"
_ADMIN_HTML = _STATIC_DIR / "admin.html"
_HUB_HTML = _STATIC_DIR / "index.html"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

_ws_rooms: dict[str, set[WebSocket]] = {}


def _cors_origins(settings: Settings) -> list[str]:
    raw = settings.cors_origins.strip()
    if raw == "*":
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.debug:
        logging.getLogger().setLevel(logging.DEBUG)

    from app.startup_checks import validate_settings

    validate_settings(settings)

    await connect_postgres(settings)
    db = await get_db()
    cache = await get_cache()

    if settings.debug or settings.environment != "production":
        try:
            seeded = await seed_demo_data(db)
            logger.info("Demo data ready: %s", seeded)
        except Exception as exc:
            logger.warning("Demo seed skipped: %s", exc)

    app.state.settings = settings
    app.state.db = db
    app.state.cache = cache
    yield
    await cache.close()
    await db.close()
    await close_postgres()


app = FastAPI(
    title="My Ride API",
    version=__version__,
    description="My Ride SA — AI-operated e-hailing (dispatch, pricing, support, payments).",
    lifespan=lifespan,
)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(_settings),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.security import RateLimitMiddleware, SecurityHeadersMiddleware
from app.rider_routes import router as rider_services_router
from app.promo_routes import router as promo_router

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware, max_requests=240, window_seconds=60)

app.include_router(extended_router)
app.include_router(rider_services_router)
app.include_router(promo_router)

if _STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")


def settings_dep() -> Settings:
    return get_settings()


async def db_dep() -> FirestoreDB:
    return await get_db()


async def cache_dep() -> RedisCache:
    return await get_cache()


@app.get("/")
async def root():
    """Full My Ride SA ecosystem hub (Rider · Driver · Support · Ops)."""
    if _HUB_HTML.exists():
        return FileResponse(_HUB_HTML, media_type="text/html")
    return RedirectResponse(url="/docs")


@app.get("/app")
async def app_hub():
    return RedirectResponse(url="/")


@app.get("/api")
async def api_info() -> dict[str, str]:
    return {
        "name": "My Ride API",
        "version": __version__,
        "hub": "/",
        "admin": "/admin",
        "health": "/health",
        "docs": "/docs",
        "login": "/auth/login",
        "channels": "/channels",
    }


@app.get("/channels")
async def booking_channels(settings: Settings = Depends(settings_dep)):
    """Public directory: App · Website · Phone · WhatsApp."""
    return channel_directory(settings)


@app.get("/geocode/search")
async def geocode_search(q: str = "", limit: int = 6):
    """OpenStreetMap Nominatim address autocomplete (ZA-biased)."""
    return {"results": search_places(q, limit=limit)}


@app.get("/geocode/reverse")
async def geocode_reverse(lat: float, lng: float):
    """Reverse geocode lat/lng via OpenStreetMap Nominatim."""
    place = reverse_geocode(lat, lng)
    if not place:
        return {"label": f"{lat:.5f}, {lng:.5f}", "lat": lat, "lng": lng}
    return place


@app.post("/geocode/resolve")
async def geocode_resolve(body: dict[str, Any]):
    """Resolve a free-typed address; preserves street number in label."""
    query = str(body.get("query") or body.get("q") or "").strip()
    if len(query) < 2:
        raise HTTPException(400, "query too short")
    place = resolve_address(query)
    if not place:
        raise HTTPException(404, "Address not found — add street number and suburb")
    return place


@app.post("/channels/voice/simulate")
async def simulate_voice_booking(
    body: ChannelSimulateRequest,
    db: FirestoreDB = Depends(db_dep),
    _user: AuthUser = Depends(get_current_user),
):
    return await simulate_channel_booking(
        channel="voice",
        text=body.text,
        from_number=body.from_number,
        db=db,
    )


@app.post("/channels/whatsapp/simulate")
async def simulate_whatsapp_booking(
    body: ChannelSimulateRequest,
    db: FirestoreDB = Depends(db_dep),
    _user: AuthUser = Depends(get_current_user),
):
    return await simulate_channel_booking(
        channel="whatsapp",
        text=body.text,
        from_number=body.from_number,
        db=db,
    )


@app.post("/auth/login", response_model=LoginResponse)
async def auth_login(body: LoginRequest):
    role = body.role if body.role in ("rider", "driver", "admin") else None
    user = authenticate(body.identifier, body.password, role=role)  # type: ignore[arg-type]
    token = create_token(user)
    return LoginResponse(access_token=token, user=user.to_dict())


@app.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    return user.to_dict()


@app.get("/auth/demo-accounts")
async def auth_demo_accounts(settings: Settings = Depends(settings_dep)):
    """Public demo credentials for SA ecosystem testing (disabled when ALLOW_DEMO_ACCOUNTS=false)."""
    if not settings.allow_demo_accounts:
        raise HTTPException(403, "Demo accounts disabled")
    return {"accounts": demo_credentials()}


@app.get("/health", response_model=HealthResponse)
async def health(
    settings: Settings = Depends(settings_dep),
    cache: RedisCache = Depends(cache_dep),
) -> HealthResponse:
    stripe = get_stripe()
    voice = get_voice()
    return HealthResponse(
        status="ok",
        version=__version__,
        services={
            "openai": "configured" if settings.openai_api_key else "dev-heuristic",
            "stripe": "configured" if stripe.enabled else "dev-mock",
            "twilio": "configured" if voice.enabled else "dev-mock",
            "firestore": "configured" if settings.firestore_project_id else "in-memory",
            "redis": "connected" if cache.enabled else "optional-offline",
            "postgres": postgres_status(),
            "ml": _ml_health_label(),
        },
    )


@app.get("/ops/cutover", response_model=CutoverReadyResponse)
async def cutover_ready(
    settings: Settings = Depends(settings_dep),
    cache: RedisCache = Depends(cache_dep),
) -> CutoverReadyResponse:
    """Public readiness snapshot for Path A go-live (no secrets)."""
    stripe = get_stripe()
    voice = get_voice()
    host = (settings.public_base_url or "").rstrip("/") or "http://127.0.0.1:8000"
    checks = {
        "https_public_base": host.startswith("https://"),
        "cors_locked": settings.cors_origins.strip() not in ("", "*"),
        "jwt_strong": len(settings.jwt_secret.strip()) >= 32
        and not settings.jwt_secret.startswith("my-ride-sa-dev"),
        "stripe_configured": bool(stripe.enabled),
        "stripe_webhook_secret": bool(settings.stripe_webhook_secret),
        "twilio_configured": bool(voice.enabled),
        "postgres_connected": postgres_status() in ("dual-write", "primary"),
        "redis_connected": bool(cache.enabled),
        "demo_accounts_allowed": bool(settings.allow_demo_accounts),
        "debug_off": not settings.debug,
        "environment_production": settings.environment == "production",
    }
    # Public launch requires payments + locked CORS/JWT + demos off
    required = [
        "https_public_base",
        "cors_locked",
        "jwt_strong",
        "stripe_configured",
        "stripe_webhook_secret",
        "debug_off",
        "environment_production",
    ]
    missing = [k for k in required if not checks[k]]
    if checks["demo_accounts_allowed"]:
        missing.append("demo_accounts_disabled")
    return CutoverReadyResponse(
        ready_for_public=len(missing) == 0,
        host=host,
        checks=checks,
        missing=missing,
        webhook_urls={
            "stripe": f"{host}/webhooks/stripe",
            "whatsapp": f"{host}/webhooks/whatsapp",
            "sms": f"{host}/webhooks/sms",
            "voice_incoming": f"{host}/voice/incoming",
            "voice_gather": f"{host}/voice/gather",
        },
    )


def _ml_health_label() -> str:
    try:
        from app.ml.store import get_model_store

        st = get_model_store().status()
        n = int(st["surge"]["updates"]) + int(st["eta"]["updates"])
        return "trained" if n >= 20 else "cold-start"
    except Exception:
        return "unavailable"


@app.post("/dev/seed")
async def dev_seed(db: FirestoreDB = Depends(db_dep)) -> dict[str, Any]:
    if not get_settings().debug:
        raise HTTPException(403, "Enable DEBUG=true to use /dev/seed")
    return await seed_demo_data(db)


@app.post("/ai/parse")
async def ai_parse(body: AiParseRequest):
    return await get_dispatcher().parse(body)


@app.post("/ai/book")
async def ai_book(
    body: AiBookRequest,
    db: FirestoreDB = Depends(db_dep),
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    """AI booking: fraud + SmartRouter + DynamicPricing + WS ride offers."""
    rider_id = body.rider_id if user.role == "admin" else user.id
    drivers = await db.list_online_drivers()
    offer = await get_dispatcher().process_booking(
        rider_id=rider_id,
        pickup=body.pickup,
        dropoff=body.dropoff,
        vehicle_type=body.vehicle_type,
        drivers=drivers,
        passenger_rating=body.passenger_rating,
        loyalty_tier=body.loyalty_tier,
        fraud_signals=body.fraud_signals or None,
        pickup_address=body.pickup_address,
        dropoff_address=body.dropoff_address,
        top_n=body.top_n,
    )
    offer = {**offer, "booking_channel": body.booking_channel or "app"}
    return await create_trip_and_offer(db, offer)


@app.post("/ai/support")
async def ai_support(
    body: AiSupportRequest,
    user: AuthUser = Depends(get_current_user),
):
    """CustomerServiceAI resolution (heuristic or LLM)."""
    return await get_dispatcher().handle_support(
        user_id=user.id,
        query=body.query,
        channel=body.channel,
        context=body.context or None,
    )


@app.get("/ai/suggestions")
async def ai_suggestions(
    db: FirestoreDB = Depends(db_dep),
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    return {"suggestions": await predictive_suggestions(user.id, db)}


@app.get("/ai/driver-insights/{driver_id}")
async def ai_driver_insights(
    driver_id: str,
    db: FirestoreDB = Depends(db_dep),
    user: AuthUser = Depends(require_role("driver", "admin")),
):
    if user.role == "driver" and user.id != driver_id:
        raise HTTPException(403, "Cannot view another driver's insights")
    return await driver_daily_insights(driver_id, db)


@app.get("/ai/ml/status")
async def ml_status():
    """Part 12 — trained surge / ETA / match model status."""
    from app.ml.store import get_model_store

    return get_model_store().status()


@app.post("/ai/ml/train")
async def ml_train(
    db: FirestoreDB = Depends(db_dep),
    _admin: AuthUser = Depends(require_role("admin")),
):
    """Retrain surge/ETA/match from synthetic + completed trips."""
    from app.ml.trainer import train_from_db

    return await train_from_db(db)


@app.post("/rides/schedule")
async def schedule_ride(
    body: ScheduleRideRequest,
    db: FirestoreDB = Depends(db_dep),
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    rider_id = body.rider_id if user.role == "admin" else user.id
    trip = await db.create_trip(
        {
            "rider_id": rider_id,
            "pickup": body.pickup.model_dump(),
            "dropoff": body.dropoff.model_dump(),
            "pickup_address": body.pickup_address,
            "dropoff_address": body.dropoff_address,
            "status": TripStatus.requested.value,
            "scheduled_for": body.scheduled_for.isoformat(),
            "vehicle_type": body.vehicle_type,
            "currency": "zar",
        }
    )
    return {"trip": trip, "scheduled_for": body.scheduled_for.isoformat(), "status": "scheduled"}


@app.get("/rides/history")
async def ride_history(
    db: FirestoreDB = Depends(db_dep),
    user: AuthUser = Depends(get_current_user),
    limit: int = 20,
):
    if user.role == "driver":
        trips = await db.list_trips(driver_id=user.id, limit=limit)
    elif user.role == "admin":
        trips = await db.list_trips(limit=limit)
    else:
        trips = await db.list_trips_for_rider(user.id, limit=limit)
    return {"trips": trips}


@app.post("/rides/rate")
async def rate_trip(
    body: RateTripRequest,
    db: FirestoreDB = Depends(db_dep),
    user: AuthUser = Depends(get_current_user),
):
    trip = await db.get_trip(body.trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    field = "passenger_rating" if body.from_role == "driver" else "driver_rating"
    updated = await db.update_trip(
        body.trip_id,
        {field: body.rating, "rating_comment": body.comment, "rated_by": user.id},
    )
    return {"trip": updated, "rating": body.rating}


@app.get("/admin")
async def admin_dashboard():
    if not _ADMIN_HTML.exists():
        raise HTTPException(404, "Admin dashboard missing")
    return FileResponse(_ADMIN_HTML, media_type="text/html")


@app.get("/admin/metrics")
async def admin_metrics(
    db: FirestoreDB = Depends(db_dep),
    _admin=Depends(require_role("admin")),
):
    return await collect_admin_metrics(db)


@app.post("/payments/reconcile/{trip_id}")
async def reconcile_payment(
    trip_id: str,
    db: FirestoreDB = Depends(db_dep),
    _admin: AuthUser = Depends(require_role("admin")),
):
    try:
        record = await get_reconciliation().reconcile_trip(db, trip_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return record.to_dict()


@app.get("/payments/ledger")
async def payment_ledger(_admin: AuthUser = Depends(require_role("admin"))):
    return {"items": get_reconciliation().list_ledger()}


@app.post("/riders")
async def create_rider(
    body: dict[str, Any],
    db: FirestoreDB = Depends(db_dep),
    _admin: AuthUser = Depends(require_role("admin")),
):
    return await db.create_rider(body)


@app.post("/drivers")
async def create_driver(
    body: dict[str, Any],
    db: FirestoreDB = Depends(db_dep),
    _admin: AuthUser = Depends(require_role("admin")),
):
    return await db.create_driver(body)


@app.patch("/drivers/location")
async def update_driver_location(
    body: DriverLocationUpdate,
    db: FirestoreDB = Depends(db_dep),
    cache: RedisCache = Depends(cache_dep),
    user: AuthUser = Depends(require_role("driver", "admin")),
):
    assert_self_or_admin(user, body.driver_id, label="driver")
    driver = await db.update_driver_location(body.driver_id, body.location, body.is_online)
    if not driver:
        raise HTTPException(404, "Driver not found")
    await cache.set_json(f"driver:{body.driver_id}:location", driver.model_dump(mode="json"))
    return driver


@app.post("/drivers/nearby")
async def nearby_drivers(
    body: NearbyDriversRequest,
    db: FirestoreDB = Depends(db_dep),
    _user: AuthUser = Depends(get_current_user),
):
    drivers = await db.list_online_drivers()
    return filter_nearby_drivers(drivers, body.center, body.radius_km, body.limit)


@app.post("/trips")
async def create_trip(
    body: TripCreateRequest,
    db: FirestoreDB = Depends(db_dep),
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    assert_self_or_admin(user, body.rider_id, label="rider")
    trip = await db.create_trip(body.model_dump(mode="json"))
    await _broadcast_trip(trip.id, "trip.created", trip.model_dump(mode="json"))
    return trip


@app.get("/trips/{trip_id}")
async def get_trip(
    trip_id: str,
    db: FirestoreDB = Depends(db_dep),
    user: AuthUser = Depends(get_current_user),
):
    trip = await db.get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    if user.role == "rider" and trip.rider_id != user.id:
        raise HTTPException(403, "Not your trip")
    if user.role == "driver" and trip.driver_id and trip.driver_id != user.id:
        raise HTTPException(403, "Not your trip")
    return trip


@app.post("/trips/{trip_id}/assign")
async def assign_trip(
    trip_id: str,
    body: TripAssignRequest,
    db: FirestoreDB = Depends(db_dep),
    user: AuthUser = Depends(require_role("driver", "admin")),
):
    assert_self_or_admin(user, body.driver_id, label="driver")
    trip = await db.update_trip(
        trip_id,
        {"driver_id": body.driver_id, "status": TripStatus.driver_assigned.value},
    )
    if not trip:
        raise HTTPException(404, "Trip not found")
    await _broadcast_trip(trip_id, "trip.assigned", trip.model_dump(mode="json"))
    return trip


@app.post("/trips/{trip_id}/status/{status}")
async def update_trip_status(
    trip_id: str,
    status: TripStatus,
    db: FirestoreDB = Depends(db_dep),
    user: AuthUser = Depends(require_role("driver", "rider", "admin")),
):
    existing = await db.get_trip(trip_id)
    if not existing:
        raise HTTPException(404, "Trip not found")
    if user.role == "rider" and existing.rider_id != user.id:
        raise HTTPException(403, "Not your trip")
    if user.role == "driver" and existing.driver_id and existing.driver_id != user.id:
        raise HTTPException(403, "Not your trip")
    trip = await db.update_trip(trip_id, {"status": status.value})
    if not trip:
        raise HTTPException(404, "Trip not found")
    await _broadcast_trip(trip_id, "trip.status", {"status": status.value})
    return trip


@app.post("/payments/hold")
async def payment_hold(
    body: PaymentHoldRequest,
    db: FirestoreDB = Depends(db_dep),
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    assert_self_or_admin(user, body.rider_id, label="rider")
    stripe = get_stripe()
    result = await stripe.create_hold(body.amount_cents, body.rider_id, body.trip_id, body.currency)
    trip = await db.get_trip(body.trip_id)
    if trip:
        await db.update_trip(
            body.trip_id,
            {"payment_intent_id": result["id"], "payment_status": "authorized"},
        )
    return result


@app.post("/payments/capture")
async def payment_capture(
    body: PaymentCaptureRequest,
    db: FirestoreDB = Depends(db_dep),
    user: AuthUser = Depends(require_role("driver", "admin")),
):
    _ = user
    stripe = get_stripe()
    result = await stripe.capture(body.payment_intent_id, body.amount_cents)
    if await db.get_trip(body.trip_id):
        await db.update_trip(body.trip_id, {"payment_status": "captured"})
    return result


@app.post("/payments/transfer")
async def payment_transfer(
    body: PaymentTransferRequest,
    _admin: AuthUser = Depends(require_role("admin")),
):
    return await get_stripe().transfer_to_driver(
        body.amount_cents,
        body.driver_stripe_account_id,
        body.trip_id,
    )


@app.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    from app.webhooks_security import verify_stripe_webhook

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    event = verify_stripe_webhook(payload, sig)
    event_type = event.get("type") if isinstance(event, dict) else getattr(event, "type", "?")
    logger.info("Stripe webhook: %s", event_type)
    # Idempotent ack — payment state is driven by capture/reconcile paths
    return {"received": True, "type": event_type}


@app.post("/voice/incoming", response_class=Response)
async def voice_incoming(request: Request):
    from app.webhooks_security import verify_twilio_request

    await verify_twilio_request(request)
    return Response(content=get_voice().welcome_twiml(), media_type="application/xml")


def _form_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value) if value != "" else None


@app.post("/voice/gather", response_class=Response)
async def voice_gather(request: Request):
    from app.webhooks_security import verify_twilio_request

    params = await verify_twilio_request(request)
    gather = TwilioVoiceGather(
        call_sid=_form_str(params.get("CallSid")) or "",
        from_number=_form_str(params.get("From")) or "",
        speech_result=_form_str(params.get("SpeechResult")),
        digits=_form_str(params.get("Digits")),
    )
    speech = gather.speech_result or gather.digits or ""
    dispatcher = get_dispatcher()
    ai = await dispatcher.parse(
        AiParseRequest(text=speech, user_id=gather.from_number, channel="voice")
    )
    if ai.intent == "support":
        result = await dispatcher.handle_support(
            user_id=gather.from_number, query=speech, channel="voice"
        )
        reply = result.get("message") or "Support noted."
        return Response(content=get_voice().gather_twiml(gather, reply), media_type="application/xml")

    if ai.intent == "book_ride":
        db = await get_db()
        drivers = await db.list_online_drivers()
        pickup = ai.suggested_trip.pickup if ai.suggested_trip else GeoPoint(lat=-33.9249, lng=18.4241)
        dropoff = ai.suggested_trip.dropoff if ai.suggested_trip else GeoPoint(lat=-33.9180, lng=18.4232)
        offer = await dispatcher.process_booking(
            rider_id=gather.from_number or "voice-rider",
            pickup=pickup,
            dropoff=dropoff,
            drivers=drivers,
            pickup_address=ai.suggested_trip.pickup_address if ai.suggested_trip else None,
            dropoff_address=ai.suggested_trip.dropoff_address if ai.suggested_trip else None,
        )
        result = await create_trip_and_offer(db, offer)
        fare = (result.get("fare") or {}).get("total", "?")
        trip_ref = (result.get("trip_id") or "pending")[:8]
        reply = f"Your ride is booked. Trip {trip_ref}. Estimated fare {fare} rand."
        return Response(content=get_voice().dispatch_twiml(reply), media_type="application/xml")

    reply = ai.reply or "I understood your request."
    return Response(content=get_voice().gather_twiml(gather, reply), media_type="application/xml")


@app.post("/webhooks/whatsapp")
async def whatsapp_webhook(request: Request):
    from urllib.parse import urlencode

    from app.webhooks_security import verify_twilio_request

    params = await verify_twilio_request(request)
    body = urlencode(params).encode("utf-8")
    inbound = get_whatsapp().parse_form_body(body)
    reply = await get_whatsapp().handle_inbound(inbound)
    return PlainTextResponse(get_whatsapp().twiml_ack(reply), media_type="application/xml")


@app.post("/webhooks/sms")
async def sms_webhook(request: Request):
    from urllib.parse import urlencode

    from app.webhooks_security import verify_twilio_request

    params = await verify_twilio_request(request)
    body = urlencode(params).encode("utf-8")
    from_number, text = get_sms().parse_form(body)
    reply = await get_sms().handle_inbound(from_number, text)
    return Response(content=get_sms().twiml(reply), media_type="application/xml")


@app.websocket("/ws/trips/{trip_id}")
async def trip_websocket(websocket: WebSocket, trip_id: str):
    await websocket.accept()
    _ws_rooms.setdefault(trip_id, set()).add(websocket)
    try:
        await websocket.send_json(
            WebSocketEvent(
                type="connected",
                trip_id=trip_id,
                timestamp=datetime.now(timezone.utc),
            ).model_dump(mode="json")
        )
        while True:
            raw = await websocket.receive_text()
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                continue
            await _broadcast_trip(trip_id, event.get("type", "client.event"), event, exclude=websocket)
    except WebSocketDisconnect:
        pass
    finally:
        _ws_rooms.get(trip_id, set()).discard(websocket)


async def _broadcast_trip(
    trip_id: str,
    event_type: str,
    payload: dict[str, Any],
    exclude: WebSocket | None = None,
) -> None:
    event = WebSocketEvent(
        type=event_type,
        trip_id=trip_id,
        payload=payload,
        timestamp=datetime.now(timezone.utc),
    ).model_dump(mode="json")
    dead: list[WebSocket] = []
    for ws in _ws_rooms.get(trip_id, set()):
        if ws is exclude:
            continue
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _ws_rooms.get(trip_id, set()).discard(ws)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})
