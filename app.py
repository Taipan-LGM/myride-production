import asyncio
import os
from pathlib import Path
from typing import Literal, Optional

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from services.auth_service import AuthenticationError, AuthService
from services.ecosystem_service import EcosystemService
from services.rate_limit_service import RateLimiter
from services.stripe_service import create_mock_payment_intent, create_payment_intent, is_stripe_configured, verify_webhook_signature


BASE_DIR = Path(__file__).resolve().parent
ecosystem = EcosystemService()
auth = AuthService()
bearer = HTTPBearer(auto_error=False)
api_limiter = RateLimiter(limit=int(os.getenv("MYRIDE_RATE_LIMIT", "120")), window_seconds=60)
auth_limiter = RateLimiter(limit=int(os.getenv("MYRIDE_AUTH_RATE_LIMIT", "10")), window_seconds=60)
rate_limit_audit_limiter = RateLimiter(limit=1, window_seconds=60)

app = FastAPI(
    title="MyRide Autonomous Mobility API",
    description="AI-operated dispatch, pricing, safety, support, and reconciliation ecosystem",
    version="2.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.middleware("http")
async def rate_limit_requests(request: Request, call_next):
    if not request.url.path.startswith("/api/"):
        return await call_next(request)
    client_ip = request.client.host if request.client else "unknown"
    limiter = auth_limiter if request.url.path == "/api/v1/auth/session" else api_limiter
    client_key = f"{client_ip}:{request.url.path}"
    result = limiter.check(client_key)
    if not result["allowed"]:
        if rate_limit_audit_limiter.check(client_key)["allowed"]:
            ecosystem.audit(client_ip, "request.rate_limited", request.url.path, "blocked", {"method": request.method})
        return JSONResponse(
            status_code=429,
            content={"detail": "Request rate limit exceeded"},
            headers={"Retry-After": str(result["retry_after"]), "X-RateLimit-Remaining": "0"},
        )
    response = await call_next(request)
    response.headers["X-RateLimit-Remaining"] = str(result["remaining"])
    return response


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    address: str = Field(min_length=2, max_length=300)


class RideRequest(BaseModel):
    rider_id: str = "demo-rider"
    pickup: Location
    dropoff: Location
    vehicle_type: Literal["standard", "comfort", "xl"] = "standard"
    payment_method: Literal["cash", "card", "wallet"] = "cash"
    channel: Literal["app", "web", "voice", "whatsapp", "sms", "widget"] = "web"
    scheduled_for: Optional[str] = None
    passenger_preferences: dict = {}


class LegacyRideRequest(BaseModel):
    rider_id: str
    pickup_lat: float
    pickup_lng: float
    dropoff_lat: float
    dropoff_lng: float
    payment_method: Literal["cash", "card", "wallet"] = "cash"


class RideStatusUpdate(BaseModel):
    status: Literal["arrived", "started", "completed", "cancelled"]


class SupportRequest(BaseModel):
    rider_id: str = "demo-rider"
    message: str = Field(min_length=2, max_length=2000)
    ride_id: Optional[str] = None


class LoginRequest(BaseModel):
    role: Literal["passenger", "driver", "admin"]
    password: str = Field(min_length=6, max_length=200)


def require_roles(*roles):
    async def authorize(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
        if not credentials:
            raise HTTPException(status_code=401, detail="Access token required", headers={"WWW-Authenticate": "Bearer"})
        try:
            return auth.verify_token(credentials.credentials, roles)
        except AuthenticationError as error:
            status_code = 403 if str(error) == "Insufficient role" else 401
            raise HTTPException(status_code=status_code, detail=str(error)) from error
    return authorize


passenger_access = require_roles("passenger", "admin")
driver_access = require_roles("driver", "admin")
admin_access = require_roles("admin")
authenticated_access = require_roles("passenger", "driver", "admin")


def perform_booking(payload):
    try:
        return ecosystem.book_ride(payload)
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.get("/", include_in_schema=False)
@app.get("/rider", include_in_schema=False)
@app.get("/driver", include_in_schema=False)
@app.get("/admin", include_in_schema=False)
async def frontend():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/health", tags=["platform"])
async def health():
    return {
        "status": "healthy", "version": app.version, "database": "connected",
        "stripe": "live" if is_stripe_configured() else "development-mock",
        "ai_dispatcher": "operational", "realtime": "operational",
    }


@app.get("/ready", tags=["platform"])
async def ready():
    return {"ready": True, "drivers_seeded": len(ecosystem.list_drivers())}


@app.post("/api/v1/auth/session", tags=["identity"])
async def create_session(request: LoginRequest, http_request: Request):
    try:
        token = auth.authenticate(request.role, request.password)
    except AuthenticationError as error:
        ecosystem.audit(http_request.client.host if http_request.client else "unknown", "auth.login", request.role, "denied")
        raise HTTPException(status_code=401, detail=str(error)) from error
    user_ids = {"passenger": "demo-rider", "driver": "drv_thabo", "admin": "admin-operator"}
    ecosystem.audit(user_ids[request.role], "auth.login", request.role)
    return {"access_token": token, "token_type": "bearer", "role": request.role, "expires_in": auth.token_ttl_seconds}


@app.post("/api/v1/auth/demo-session/{role}", tags=["identity"], include_in_schema=False)
async def create_demo_session(role: Literal["passenger", "driver", "admin"]):
    if os.getenv("ENVIRONMENT", "development") != "development":
        raise HTTPException(status_code=404, detail="Not found")
    user_ids = {"passenger": "demo-rider", "driver": "drv_thabo", "admin": "admin-operator"}
    return {"access_token": auth.issue_token(user_ids[role], role), "token_type": "bearer", "role": role, "expires_in": auth.token_ttl_seconds}


@app.post("/api/v1/rides/quote", tags=["passenger"])
async def quote_ride(request: RideRequest, _user=Depends(passenger_access)):
    return ecosystem.quote(
        (request.pickup.lat, request.pickup.lng),
        (request.dropoff.lat, request.dropoff.lng),
        request.vehicle_type,
    )


@app.post("/api/v1/rides/book", status_code=201, tags=["passenger"])
async def book_ride(request: RideRequest, user=Depends(passenger_access)):
    request.rider_id = user["sub"]
    ride = perform_booking(request.model_dump())
    ecosystem.audit(user["sub"], "ride.booked", ride["ride_id"], metadata={"channel": request.channel, "vehicle_type": request.vehicle_type})
    return ride


@app.post("/api/rides/book", status_code=201, tags=["compatibility"])
async def book_legacy_ride(request: LegacyRideRequest, user=Depends(passenger_access)):
    payload = {
        "rider_id": user["sub"],
        "pickup": {"lat": request.pickup_lat, "lng": request.pickup_lng, "address": "Sandton City, Sandton"},
        "dropoff": {"lat": request.dropoff_lat, "lng": request.dropoff_lng, "address": "Rosebank Mall, Rosebank"},
        "vehicle_type": "standard", "payment_method": request.payment_method, "channel": "web",
    }
    ride = perform_booking(payload)
    ecosystem.audit(user["sub"], "ride.booked", ride["ride_id"], metadata={"channel": "web", "vehicle_type": "standard"})
    return ride


@app.get("/api/v1/rides/{ride_id}", tags=["passenger"])
async def get_ride(ride_id: str, user=Depends(authenticated_access)):
    ride = ecosystem.get_ride(ride_id)
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    if user["role"] == "passenger" and ride["rider_id"] != user["sub"]:
        raise HTTPException(status_code=403, detail="Passengers can only access their own rides")
    if user["role"] == "driver" and ride["driver_id"] != user["sub"]:
        raise HTTPException(status_code=403, detail="Drivers can only access assigned rides")
    return ride


@app.patch("/api/v1/rides/{ride_id}/status", tags=["driver"])
async def update_ride_status(ride_id: str, update: RideStatusUpdate, user=Depends(driver_access)):
    try:
        ride = ecosystem.get_ride(ride_id)
        if not ride:
            raise KeyError(ride_id)
        if user["role"] == "driver" and ride["driver_id"] != user["sub"]:
            raise HTTPException(status_code=403, detail="Drivers can only update assigned rides")
        updated = ecosystem.update_ride(ride_id, update.status)
        ecosystem.audit(user["sub"], f"ride.{update.status}", ride_id, metadata={"role": user["role"]})
        return updated
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Ride not found") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.get("/api/v1/drivers", tags=["driver"])
async def drivers(user=Depends(driver_access)):
    drivers_list = ecosystem.list_drivers()
    if user["role"] == "driver":
        drivers_list = [driver for driver in drivers_list if driver["id"] == user["sub"]]
    return {"drivers": drivers_list}


@app.get("/api/v1/drivers/{driver_id}/rides", tags=["driver"])
async def driver_rides(driver_id: str, user=Depends(driver_access)):
    if user["role"] == "driver" and user["sub"] != driver_id:
        raise HTTPException(status_code=403, detail="Drivers can only access their own rides")
    return {"rides": [ride for ride in ecosystem.list_rides() if ride["driver_id"] == driver_id]}


@app.post("/api/v1/assistant/chat", tags=["AI operations"])
async def assistant(request: SupportRequest, user=Depends(authenticated_access)):
    if user["role"] == "passenger":
        request.rider_id = user["sub"]
    result = ecosystem.support(request.rider_id, request.message, request.ride_id)
    ecosystem.audit(user["sub"], "support.handled", result["case_id"], result["status"], {"category": result["category"], "escalated": result["escalated"]})
    return result


@app.get("/api/v1/admin/metrics", tags=["admin"])
async def admin_metrics(_user=Depends(admin_access)):
    return ecosystem.metrics()


@app.get("/api/v1/admin/rides", tags=["admin"])
async def admin_rides(limit: int = Query(50, ge=1, le=500), _user=Depends(admin_access)):
    return {"rides": ecosystem.list_rides(limit)}


@app.get("/api/v1/admin/drivers", tags=["admin"])
async def admin_drivers(_user=Depends(admin_access)):
    return {"drivers": ecosystem.list_drivers()}


@app.get("/api/v1/admin/audit", tags=["admin"])
async def admin_audit(limit: int = Query(100, ge=1, le=500), _user=Depends(admin_access)):
    return {"events": ecosystem.list_audit_events(limit)}



@app.post("/api/v1/payments/create-intent", tags=["payments"])
@app.post("/api/payments/create-intent", tags=["compatibility"])
async def create_payment(amount: float, currency: str = "zar", _user=Depends(passenger_access)):
    if amount <= 0 or amount > 100000:
        raise HTTPException(status_code=422, detail="Amount must be between 0 and 100000")
    result = create_payment_intent(amount, currency) if is_stripe_configured() else create_mock_payment_intent(amount)
    if not result.success:
        raise HTTPException(status_code=400, detail=result.error)
    response = {
        "client_secret": result.client_secret, "payment_id": result.payment_id,
        "amount": result.amount, "currency": result.currency,
        "mode": "live" if is_stripe_configured() else "development-mock",
    }
    ecosystem.audit(_user["sub"], "payment.intent_created", result.payment_id, metadata={"currency": currency, "mode": response["mode"]})
    return response


@app.post("/api/v1/payments/webhook", tags=["payments"], include_in_schema=False)
async def payment_webhook(request: Request):
    payload = await request.body()
    if not verify_webhook_signature(payload, request.headers.get("stripe-signature", "")):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    try:
        event = await request.json()
        payment_object = event.get("data", {}).get("object", {})
        metadata = payment_object.get("metadata", {}) or {}
        result = ecosystem.process_payment_event(
            event_id=event["id"], event_type=event["type"],
            ride_id=metadata.get("ride_id"), payment_id=payment_object.get("id"),
        )
        ecosystem.audit("stripe", "payment.webhook_received", event["id"], "duplicate" if result["duplicate"] else "success", {"event_type": event["type"]})
        return result
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=400, detail="Invalid payment event payload") from error


@app.websocket("/ws/rides/{ride_id}")
async def ride_stream(websocket: WebSocket, ride_id: str):
    try:
        user = auth.verify_token(websocket.query_params.get("token", ""), {"passenger", "driver", "admin"})
    except AuthenticationError:
        await websocket.close(code=4401)
        return
    ride = ecosystem.get_ride(ride_id)
    if not ride or (user["role"] == "passenger" and ride["rider_id"] != user["sub"]) or (user["role"] == "driver" and ride["driver_id"] != user["sub"]):
        await websocket.close(code=4403)
        return
    await websocket.accept()
    try:
        while True:
            ride = ecosystem.get_ride(ride_id)
            if not ride:
                await websocket.send_json({"type": "error", "message": "Ride not found"})
                return
            await websocket.send_json({"type": "ride.updated", "ride": ride})
            await asyncio.sleep(2)
    except (WebSocketDisconnect, RuntimeError):
        return
    except Exception as error:
        if error.__class__.__name__.startswith("ConnectionClosed"):
            return
        raise
        return


@app.websocket("/ws/admin/metrics")
async def metrics_stream(websocket: WebSocket):
    try:
        auth.verify_token(websocket.query_params.get("token", ""), {"admin"})
    except AuthenticationError:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    try:
        while True:
            await websocket.send_json({"type": "metrics.updated", "metrics": ecosystem.metrics()})
            await asyncio.sleep(3)
    except (WebSocketDisconnect, RuntimeError):
        return
    except Exception as error:
        if error.__class__.__name__.startswith("ConnectionClosed"):
            return
        raise
        return


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)
