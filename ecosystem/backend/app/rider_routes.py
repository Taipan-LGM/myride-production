"""Rider wallet, loyalty, places, safety SOS, carbon, driver earnings."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import AuthUser, assert_self_or_admin, get_current_user, require_role
from app.firestore_db import FirestoreDB, get_db
from app.rider_services import (
    award_loyalty_for_trip,
    carbon_for_distance_km,
    charge_wallet,
    get_loyalty,
    get_wallet,
    list_saved_places,
    save_place,
    top_up_wallet,
)
from app.safety_ops import (
    EMERGENCY_NUMBER,
    create_share_link,
    get_share,
    list_sos,
    trigger_sos,
)

router = APIRouter(tags=["rider-services"])


class SosRequest(BaseModel):
    trip_id: str | None = None
    lat: float | None = None
    lng: float | None = None
    note: str | None = None


class ShareRequest(BaseModel):
    trip_id: str
    ttl_seconds: int = Field(default=3600, ge=60, le=86_400)


class TopUpRequest(BaseModel):
    amount_cents: int = Field(ge=100, le=500_000)
    user_id: str | None = None


class ChargeWalletRequest(BaseModel):
    amount_cents: int = Field(ge=1, le=500_000)
    user_id: str | None = None
    trip_id: str | None = None


class SavePlaceRequest(BaseModel):
    kind: str = "other"  # home | work | other
    label: str = Field(min_length=1, max_length=200)
    lat: float
    lng: float
    house_number: str | None = None


class CarbonRequest(BaseModel):
    distance_km: float = Field(ge=0, le=2000)


@router.get("/safety/emergency")
async def emergency_info():
    """Public SA emergency dial info."""
    return {
        "country": "ZA",
        "emergency_number": EMERGENCY_NUMBER,
        "dial": f"tel:{EMERGENCY_NUMBER}",
        "message": f"In an emergency, call {EMERGENCY_NUMBER} (South Africa).",
        "also": ["10111 police", "10177 ambulance (legacy)"],
    }


@router.post("/safety/sos")
async def sos(
    body: SosRequest,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    result = await trigger_sos(
        user_id=user.id,
        trip_id=body.trip_id,
        lat=body.lat,
        lng=body.lng,
        note=body.note,
        db=db,
    )
    return result.to_dict()


@router.get("/safety/sos")
async def sos_log(
    limit: int = 20,
    _admin: AuthUser = Depends(require_role("admin")),
):
    return {"items": list_sos(limit=limit), "emergency_number": EMERGENCY_NUMBER}


@router.post("/safety/share")
async def share_trip(
    body: ShareRequest,
    db: FirestoreDB = Depends(get_db),
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    trip = await db.get_trip(body.trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    if user.role != "admin" and trip.rider_id != user.id:
        raise HTTPException(403, "Not your trip")
    link = create_share_link(body.trip_id, user.id, ttl_seconds=body.ttl_seconds)
    return link


@router.get("/share/{token}")
async def public_share(
    token: str,
    db: FirestoreDB = Depends(get_db),
):
    row = get_share(token)
    if not row:
        raise HTTPException(404, "Share link expired or invalid")
    trip = await db.get_trip(row["trip_id"])
    if not trip:
        raise HTTPException(404, "Trip not found")
    return {
        "trip_id": trip.id,
        "status": trip.status.value if hasattr(trip.status, "value") else trip.status,
        "pickup": trip.pickup.model_dump() if trip.pickup else None,
        "dropoff": trip.dropoff.model_dump() if trip.dropoff else None,
        "driver_id": trip.driver_id,
        "message": "Live trip share — My Ride SA",
        "emergency_number": EMERGENCY_NUMBER,
    }


@router.get("/wallet")
async def wallet(user: AuthUser = Depends(get_current_user)):
    return get_wallet(user.id)


@router.get("/wallet/{user_id}")
async def wallet_for(
    user_id: str,
    user: AuthUser = Depends(get_current_user),
):
    assert_self_or_admin(user, user_id, label="user")
    return get_wallet(user_id)


@router.post("/wallet/top-up")
async def wallet_top_up(
    body: TopUpRequest,
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    uid = body.user_id or user.id
    assert_self_or_admin(user, uid, label="user")
    return top_up_wallet(uid, body.amount_cents)


@router.post("/wallet/charge")
async def wallet_charge(
    body: ChargeWalletRequest,
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    uid = body.user_id or user.id
    assert_self_or_admin(user, uid, label="user")
    try:
        return {**charge_wallet(uid, body.amount_cents), "trip_id": body.trip_id}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/loyalty")
async def loyalty(user: AuthUser = Depends(get_current_user)):
    return get_loyalty(user.id)


@router.get("/loyalty/{user_id}")
async def loyalty_for(
    user_id: str,
    user: AuthUser = Depends(get_current_user),
):
    assert_self_or_admin(user, user_id, label="user")
    return get_loyalty(user_id)


@router.get("/places")
async def places(user: AuthUser = Depends(get_current_user)):
    return {"places": list_saved_places(user.id)}


@router.post("/places")
async def places_save(
    body: SavePlaceRequest,
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    kind = (body.kind or "other").lower()
    if kind not in ("home", "work", "other"):
        raise HTTPException(400, "kind must be home, work, or other")
    payload = body.model_dump()
    payload["kind"] = kind
    entry = save_place(user.id, payload)
    return {"place": entry, "places": list_saved_places(user.id)}


@router.post("/carbon/estimate")
async def carbon_estimate(body: CarbonRequest):
    return carbon_for_distance_km(body.distance_km)


@router.get("/driver/earnings")
async def earnings_me(
    user: AuthUser = Depends(require_role("driver", "admin")),
    db: FirestoreDB = Depends(get_db),
):
    return await db.driver_earnings_summary(user.id)


@router.get("/driver/earnings/{driver_id}")
async def earnings_for(
    driver_id: str,
    user: AuthUser = Depends(require_role("driver", "admin")),
    db: FirestoreDB = Depends(get_db),
):
    assert_self_or_admin(user, driver_id, label="driver")
    return await db.driver_earnings_summary(driver_id)


# Re-export for complete_ride hooks
__all__ = ["router", "award_loyalty_for_trip"]
