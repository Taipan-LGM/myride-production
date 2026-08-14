from __future__ import annotations

import asyncio
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
    authenticate_firebase,
    create_token,
    demo_credentials,
    get_current_user,
    get_websocket_user,
    require_role,
)
from app.channels import channel_directory, simulate_channel_booking
from app.cartrack_service import CartrackNotConfigured, CartrackUpstreamError, close_cartrack, get_cartrack
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
    FirebaseLoginRequest,
    LoginRequest,
    LoginResponse,
    NearbyDriversRequest,
    PaymentCaptureRequest,
    PaymentHoldRequest,
    PaymentTransferRequest,
    RateTripRequest,
    RefundTripRequest,
    RemunerationPolicyUpdate,
    ScheduleRideRequest,
    TripAssignRequest,
    TripCreateRequest,
    TripStatus,
    TwilioVoiceGather,
    WebSocketEvent,
)
from app.offer_stream import create_trip_and_offer
from app.observability import get_observability
from app.reconciliation import ReconciliationNotReady, get_reconciliation
from app.refunds import RefundInProgress, RefundNotReady, get_refund_service
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
    # Launch the live /ws/ops observability stream pump.
    pump_task = asyncio.create_task(_observability_pump())
    app.state.observability_pump = pump_task
    yield
    pump_task.cancel()
    try:
        await pump_task
    except asyncio.CancelledError:
        pass
    await close_cartrack()
    await cache.close()
    await db.close()
    await close_postgres()


app = FastAPI(
    title="My Ride API",
    description="My Ride SA — AI-operated e-hailing (dispatch, pricing, support, payments).",
    version="0.3.3",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
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


@app.post("/auth/firebase", response_model=LoginResponse)
async def auth_firebase(body: FirebaseLoginRequest):
    role = body.role.value if body.role else None
    user = authenticate_firebase(body.id_token, requested_role=role)
    token = create_token(user)
    return LoginResponse(access_token=token, user=user.to_dict())


@app.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    return user.to_dict()


@router.get("/auth/demo-accounts")
async def auth_demo_accounts(
    settings: Settings = Depends(settings_dep),
    user: AuthUser | None = Depends(get_current_user),
) -> dict[str, list[dict[str, str]]]:
    """Demo credentials for SA ecosystem testing (disabled when ALLOW_DEMO_ACCOUNTS=false).

    Accessible to any authenticated user in demo mode — not just admins.
    """
    if not settings.allow_demo_accounts:
        raise HTTPException(403, "Demo accounts disabled")
    # Require authentication; any logged-in user can view demo credentials.
    if user is None:
        raise HTTPException(401, "Login required to view demo credentials")
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
        "postgres_primary": postgres_status() == "primary",
        "redis_connected": bool(cache.enabled),
        "firebase_auth_configured": bool(settings.firestore_project_id),
        "demo_accounts_allowed": bool(settings.allow_demo_accounts),
        "debug_off": not settings.debug,
        "environment_production": settings.environment == "production",
        "phase0_seed_allowed": bool(settings.allow_phase0_seed),
    }
    # Public launch requires payments + locked CORS/JWT + demos off
    required = [
        "https_public_base",
        "cors_locked",
        "jwt_strong",
        "stripe_configured",
        "stripe_webhook_secret",
        "firebase_auth_configured",
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


# --------------------------------------------------------------------------- #
# Observability surface (Part 10 of the brief):
#   - /ops/observability            snapshot for the admin dashboard
#   - /ops/observability/recent     raw event feed (paginated by kind)
#   - /ops/observability/safety/test  admin-only safety telemetry evaluator
#   - /ops/observability/fraud/test   admin-only fraud signal evaluator
#   - /ws/ops                        live WebSocket stream (every 3s)
# --------------------------------------------------------------------------- #

_observability_ws_clients: set[WebSocket] = set()


async def _broadcast_observability(payload: dict[str, Any]) -> None:
    dead: list[WebSocket] = []
    for ws in _observability_ws_clients:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _observability_ws_clients.discard(ws)


async def _observability_pump() -> None:
    """Background task: snapshot every 3s and push to /ws/ops subscribers."""
    while True:
        try:
            await asyncio.sleep(3.0)
            db = await get_db()
            payload = await get_observability().snapshot(db)
            payload["type"] = "ops.snapshot"
            await _broadcast_observability(payload)
        except asyncio.CancelledError:
            return
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("observability pump error: %s", exc)


@app.get("/ops/observability")
async def ops_observability(
    db: FirestoreDB = Depends(db_dep),
    _admin: AuthUser = Depends(require_role("admin")),
):
    """Live counters + driver / trip positions for the AI Ops dashboard."""
    return await get_observability().snapshot(db)


@app.get("/ops/observability/recent")
async def ops_observability_recent(
    kind: str = "all",
    limit: int = 25,
    _admin: AuthUser = Depends(require_role("admin")),
):
    """Tail of recent events for any single kind (or 'all')."""
    if kind == "all":
        return {
            kind_: get_observability().recent(kind_, limit)
            for kind_ in ("fraud", "safety", "support", "trip")
        }
    if kind not in {"fraud", "safety", "support", "trip"}:
        raise HTTPException(400, "kind must be fraud|safety|support|trip")
    return {kind: get_observability().recent(kind, limit)}


@app.post("/ops/observability/safety/test")
async def ops_safety_test(
    payload: dict[str, Any],
    db: FirestoreDB = Depends(db_dep),
    _admin: AuthUser = Depends(require_role("admin")),
):
    """Evaluate a synthetic telemetry payload through the SafetyMonitor."""
    from app.ai_dispatcher import get_dispatcher

    alerts = await get_dispatcher().monitor_trip_safety(payload or {})
    return {"alerts": alerts, "count": len(alerts)}


@app.post("/ops/observability/fraud/test")
async def ops_fraud_test(
    signals: dict[str, Any],
    _admin: AuthUser = Depends(require_role("admin")),
):
    """Evaluate synthetic booking signals through the FraudDetection engine."""
    from app.ai_dispatcher import get_dispatcher

    # Re-use the fraud path used during a real booking (process_booking
    # calls fraud.assess internally); for an isolated dry-run we reach
    # the engine directly via the dispatcher cache.
    dispatcher = get_dispatcher()
    verdict = await dispatcher.fraud.assess(signals or {})
    return verdict.to_dict()


@app.websocket("/ws/ops")
async def ws_ops(websocket: WebSocket):
    """Live ops snapshot stream. Admin auth via token message, like /ws/trips."""
    user = await get_websocket_user(websocket, "admin")
    if user is None:
        return
    _observability_ws_clients.add(websocket)
    try:
        db = await get_db()
        initial = await get_observability().snapshot(db)
        initial["type"] = "ops.snapshot"
        await websocket.send_json(initial)
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=15)
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                elif msg.get("type") == "snapshot":
                    db = await get_db()
                    payload = await get_observability().snapshot(db)
                    payload["type"] = "ops.snapshot"
                    await websocket.send_json(payload)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        _observability_ws_clients.discard(websocket)


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


@app.post("/admin/phase0/bootstrap")
async def admin_phase0_bootstrap(
    db: FirestoreDB = Depends(db_dep),
    _admin: AuthUser = Depends(require_role("admin")),
    drivers: int = 100,
    rides: int = 1000,
) -> dict[str, Any]:
    """Phase 0: seed ~100 drivers + ~1000 completed rides (admin JWT)."""
    settings = get_settings()
    if not settings.allow_phase0_seed and settings.environment == "production":
        raise HTTPException(403, "ALLOW_PHASE0_SEED=false — Phase 0 seed disabled")
    from app.phase0_ops import phase0_bootstrap

    drivers = max(1, min(drivers, 500))
    rides = max(1, min(rides, 5000))
    result = await phase0_bootstrap(db, drivers=drivers, rides=rides)
    return {"ok": True, **result}


@app.post("/admin/phase0/drivers")
async def admin_phase0_drivers(
    db: FirestoreDB = Depends(db_dep),
    _admin: AuthUser = Depends(require_role("admin")),
    count: int = 100,
) -> dict[str, Any]:
    if not get_settings().allow_phase0_seed and get_settings().environment == "production":
        raise HTTPException(403, "ALLOW_PHASE0_SEED=false")
    from app.phase0_ops import seed_drivers

    return await seed_drivers(db, count)


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


_OBSERVABILITY_HTML = _STATIC_DIR / "observability.html"


@app.get("/admin/observability")
async def admin_observability_dashboard():
    """Live ops dashboard (Part 10 of the brief)."""
    if not _OBSERVABILITY_HTML.exists():
        raise HTTPException(404, "Observability dashboard missing")
    return FileResponse(_OBSERVABILITY_HTML, media_type="text/html")


@app.get("/admin/metrics")
async def admin_metrics(
    db: FirestoreDB = Depends(db_dep),
    _admin=Depends(require_role("admin")),
):
    return await collect_admin_metrics(db)


@app.get("/admin/fleet/vehicles")
async def admin_fleet_vehicles(
    _admin: AuthUser = Depends(require_role("admin")),
    cartrack=Depends(get_cartrack),
):
    try:
        return await cartrack.list_vehicles()
    except CartrackNotConfigured as error:
        raise HTTPException(503, str(error)) from error
    except CartrackUpstreamError as error:
        raise HTTPException(502, str(error)) from error


@app.get("/admin/settings/remuneration")
async def get_remuneration_settings(
    db: FirestoreDB = Depends(db_dep),
    _admin: AuthUser = Depends(require_role("admin")),
):
    return await db.get_remuneration_policy()


@app.patch("/admin/settings/remuneration")
async def update_remuneration_settings(
    body: RemunerationPolicyUpdate,
    db: FirestoreDB = Depends(db_dep),
    admin: AuthUser = Depends(require_role("admin")),
):
    return await db.update_remuneration_policy(body.driver_share_bps, admin.id)


@app.post("/payments/reconcile/{trip_id}")
async def reconcile_payment(
    trip_id: str,
    db: FirestoreDB = Depends(db_dep),
    _admin: AuthUser = Depends(require_role("admin")),
):
    try:
        record = await get_reconciliation().reconcile_trip(db, trip_id)
    except ReconciliationNotReady as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return record.to_dict()


@app.get("/payments/ledger")
async def payment_ledger(
    db: FirestoreDB = Depends(db_dep),
    _admin: AuthUser = Depends(require_role("admin")),
):
    return {"items": await db.list_payment_records()}


@app.post("/payments/refund/{trip_id}")
async def refund_trip(
    trip_id: str,
    body: RefundTripRequest,
    db: FirestoreDB = Depends(db_dep),
    admin: AuthUser = Depends(require_role("admin")),
):
    try:
        return await get_refund_service().refund_trip(db, trip_id, admin.id, body.reason)
    except RefundInProgress as exc:
        raise HTTPException(409, str(exc)) from exc
    except RefundNotReady as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/admin/reconciliations")
async def reconciliation_queue(
    limit: int = 50,
    db: FirestoreDB = Depends(db_dep),
    _admin: AuthUser = Depends(require_role("admin")),
):
    bounded_limit = max(1, min(limit, 100))
    items = await db.list_reconciliation_trips(bounded_limit)
    return {
        "items": [
            {
                "trip_id": trip.id,
                "driver_id": trip.driver_id,
                "fare_cents": int(trip.fare_final_cents or trip.fare_estimate_cents or 0),
                "status": trip.reconciliation_status or "pending",
                "attempt_count": trip.reconciliation_attempt_count,
                "attempted_at": trip.reconciliation_attempted_at,
                "error": trip.reconciliation_error,
            }
            for trip in items
        ]
    }


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


@app.get("/drivers/me/stripe-connect")
async def driver_stripe_connect_status(
    db: FirestoreDB = Depends(db_dep),
    driver: AuthUser = Depends(require_role("driver")),
    stripe=Depends(get_stripe),
):
    if not stripe.connect_available:
        raise HTTPException(503, "Stripe Connect for South Africa is awaiting provider approval")
    profile = await db.get_driver(driver.id)
    if not profile or not profile.stripe_account_id:
        return {"status": "not_started", "account_id": None, "payouts_enabled": False}
    details = await stripe.get_connect_account_status(profile.stripe_account_id)
    status = "ready" if details["payouts_enabled"] else "pending"
    return {"status": status, "account_id": profile.stripe_account_id, **details}


@app.post("/drivers/me/stripe-connect/onboarding")
async def driver_stripe_connect_onboarding(
    db: FirestoreDB = Depends(db_dep),
    driver: AuthUser = Depends(require_role("driver")),
    stripe=Depends(get_stripe),
):
    if not stripe.connect_available:
        raise HTTPException(503, "Stripe Connect for South Africa is awaiting provider approval")
    profile = await db.get_driver(driver.id)
    if not profile:
        profile = await db.create_driver(
            {"id": driver.id, "name": driver.name, "phone": driver.phone, "email": driver.email}
        )
    if not profile.stripe_account_id:
        account = await stripe.create_connect_account(driver.id, driver.email)
        profile = await db.attach_driver_stripe_account(driver.id, account["id"])
    if not profile or not profile.stripe_account_id:
        raise HTTPException(409, "Unable to attach driver payout account")
    details = await stripe.get_connect_account_status(profile.stripe_account_id)
    status = "ready" if details["payouts_enabled"] else "pending"
    if details["payouts_enabled"]:
        link = await stripe.create_connect_login_link(profile.stripe_account_id)
    else:
        link = await stripe.create_connect_account_link(profile.stripe_account_id)
    return {
        "status": status,
        "account_id": profile.stripe_account_id,
        "onboarding_url": link.get("url"),
        "expires_at": link.get("expires_at"),
        **details,
    }


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
    if status == TripStatus.completed:
        raise HTTPException(409, "Use the complete-ride workflow to capture payment and reconcile payout")
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
    trip = await db.get_trip(body.trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    if trip.rider_id != body.rider_id:
        raise HTTPException(409, "Payment rider does not match trip")
    expected_amount = int(trip.fare_final_cents or trip.fare_estimate_cents or 0)
    if expected_amount and body.amount_cents != expected_amount:
        raise HTTPException(409, "Payment amount must match the trip fare")
    if body.currency.lower() != trip.currency.lower():
        raise HTTPException(409, "Payment currency must match the trip currency")
    if trip.payment_status != "pending":
        raise HTTPException(409, "Trip payment has already been initialized")
    stripe = get_stripe()
    result = await stripe.create_hold(body.amount_cents, body.rider_id, body.trip_id, body.currency)
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
    trip = await db.get_trip(body.trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    if user.role == "driver" and trip.driver_id != user.id:
        raise HTTPException(403, "Not assigned to this trip")
    if trip.payment_intent_id != body.payment_intent_id:
        raise HTTPException(409, "Payment reference does not match trip")
    if trip.payment_status != "authorized":
        raise HTTPException(409, "Trip payment is not authorized")
    expected_amount = int(trip.fare_final_cents or trip.fare_estimate_cents or 0)
    capture_amount = body.amount_cents if body.amount_cents is not None else expected_amount
    if capture_amount != expected_amount:
        raise HTTPException(409, "Capture amount must match the trip fare")
    stripe = get_stripe()
    result = await stripe.capture(body.payment_intent_id, capture_amount, trip.id)
    if result.get("status") != "succeeded":
        raise HTTPException(409, "Trip payment capture is not complete")
    await db.update_trip(
        body.trip_id,
        {"payment_status": "captured", "captured_amount_cents": capture_amount},
    )
    return result


@app.post("/payments/transfer")
async def payment_transfer(
    body: PaymentTransferRequest,
    _admin: AuthUser = Depends(require_role("admin")),
):
    raise HTTPException(410, "Direct transfers are disabled; use payout reconciliation")


@app.post("/webhooks/stripe")
async def stripe_webhook(request: Request, db: FirestoreDB = Depends(db_dep)):
    from app.webhooks_security import verify_stripe_webhook

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    event = verify_stripe_webhook(payload, sig)
    event_type = event.get("type") if isinstance(event, dict) else getattr(event, "type", "?")
    logger.info("Stripe webhook: %s", event_type)
    if event_type == "refund.updated":
        data = event.get("data", {}) if isinstance(event, dict) else getattr(event, "data", {})
        refund = data.get("object", {}) if isinstance(data, dict) else getattr(data, "object", {})
        get_value = refund.get if isinstance(refund, dict) else lambda key, default=None: getattr(refund, key, default)
        metadata = get_value("metadata", {}) or {}
        trip_id = metadata.get("trip_id") if isinstance(metadata, dict) else getattr(metadata, "trip_id", None)
        if trip_id and get_value("status") == "succeeded":
            await get_refund_service().finalize_refund(
                db,
                str(trip_id),
                str(get_value("id")),
                int(get_value("amount", 0)),
            )
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
async def trip_websocket(
    websocket: WebSocket,
    trip_id: str,
    db: FirestoreDB = Depends(db_dep),
):
    user = await get_websocket_user(websocket)
    if user is None:
        return
    trip = await db.get_trip(trip_id)
    if not trip:
        await websocket.close(code=4404, reason="Trip not found")
        return
    if user.role == "rider" and trip.rider_id != user.id:
        await websocket.close(code=4403, reason="Not your trip")
        return
    if user.role == "driver" and trip.driver_id != user.id:
        await websocket.close(code=4403, reason="Not your trip")
        return
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
