"""Feature helpers for My Ride ML models (no sklearn)."""

from __future__ import annotations

from datetime import datetime
from typing import Any


def zone_id(lat: float, lng: float) -> str:
    return f"z_{round(float(lat), 2)}_{round(float(lng), 2)}"


def hour_bucket(ts: datetime | None = None) -> int:
    return (ts or datetime.now()).hour


def dow(ts: datetime | None = None) -> int:
    return (ts or datetime.now()).weekday()  # 0=Mon


def surge_features(
    *,
    hour: int,
    dow: int,
    demand: int,
    supply: int,
    distance_km: float = 0.0,
) -> list[float]:
    """Dense feature vector for surge residual model."""
    ratio = demand / max(supply, 1)
    peak = 1.0 if hour in (7, 8, 9, 16, 17, 18, 19) else 0.0
    weekend = 1.0 if dow >= 5 else 0.0
    return [
        1.0,  # bias
        hour / 23.0,
        dow / 6.0,
        min(ratio, 5.0) / 5.0,
        peak,
        weekend,
        min(distance_km, 50.0) / 50.0,
    ]


def eta_features(*, distance_km: float, hour: int, dow: int) -> list[float]:
    peak = 1.0 if hour in (7, 8, 9, 16, 17, 18, 19) else 0.0
    return [
        1.0,
        min(distance_km, 40.0) / 40.0,
        hour / 23.0,
        dow / 6.0,
        peak,
    ]


def trip_training_row(trip: Any) -> dict[str, Any] | None:
    """Extract training sample from a Trip-like object."""
    try:
        pickup = trip.pickup
        dropoff = trip.dropoff
        plat = float(pickup.lat if hasattr(pickup, "lat") else pickup["lat"])
        plng = float(pickup.lng if hasattr(pickup, "lng") else pickup["lng"])
        dlat = float(dropoff.lat if hasattr(dropoff, "lat") else dropoff["lat"])
        dlng = float(dropoff.lng if hasattr(dropoff, "lng") else dropoff["lng"])
    except Exception:
        return None
    from app.geofire import haversine_km
    from app.models import GeoPoint

    dist = haversine_km(GeoPoint(lat=plat, lng=plng), GeoPoint(lat=dlat, lng=dlng))
    fare_cents = int(getattr(trip, "fare_final_cents", None) or getattr(trip, "fare_estimate_cents", None) or 0)
    return {
        "distance_km": dist,
        "fare_cents": fare_cents,
        "pickup_lat": plat,
        "pickup_lng": plng,
        "hour": hour_bucket(),
        "dow": dow(),
        "zone": zone_id(plat, plng),
    }
