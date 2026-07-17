"""Train surge / ETA / match models from trips + synthetic SA traffic."""

from __future__ import annotations

import logging
import random
from typing import Any

from app.firestore_db import FirestoreDB
from app.ml.features import dow, eta_features, hour_bucket, surge_features, trip_training_row
from app.ml.store import get_model_store
from app.models import TripStatus

logger = logging.getLogger(__name__)


def _synthetic_samples(n: int = 80) -> tuple[list[list[float]], list[float], list[list[float]], list[float]]:
    """Generate SA-ish commute samples for cold start."""
    surge_x: list[list[float]] = []
    surge_y: list[float] = []
    eta_x: list[list[float]] = []
    eta_y: list[float] = []
    for _ in range(n):
        hour = random.randint(0, 23)
        d = random.randint(0, 6)
        demand = random.randint(1, 40)
        supply = random.randint(1, 25)
        dist = random.uniform(1.0, 25.0)
        ratio = demand / max(supply, 1)
        peak = 1.0 if hour in (7, 8, 9, 16, 17, 18, 19) else 0.0
        true_surge = 1.0 + max(0.0, ratio - 1.0) * 0.35 + peak * 0.25
        true_surge = max(1.0, min(3.5, true_surge))
        # train residual vs base 1.0
        surge_x.append(surge_features(hour=hour, dow=d, demand=demand, supply=supply, distance_km=dist))
        surge_y.append(true_surge - 1.0)

        traffic = 1.4 if peak else 0.9
        speed = max(8.0, 30.0 / traffic)
        minutes = (dist / speed) * 60.0
        eta_x.append(eta_features(distance_km=dist, hour=hour, dow=d))
        eta_y.append(minutes)
    return surge_x, surge_y, eta_x, eta_y


async def train_from_db(db: FirestoreDB, *, epochs: int = 6) -> dict[str, Any]:
    store = get_model_store()
    sx, sy, ex, ey = _synthetic_samples(100)

    trips = await db.list_trips(limit=200)
    completed = [t for t in trips if t.status == TripStatus.completed]
    for t in completed:
        row = trip_training_row(t)
        if not row:
            continue
        # Approximate demand/supply from fare (higher fare → more surge)
        fare = row["fare_cents"] / 100.0
        base = 15 + row["distance_km"] * 12
        implied_surge = max(1.0, min(3.5, fare / max(base, 1.0)))
        sx.append(
            surge_features(
                hour=row["hour"],
                dow=row["dow"],
                demand=int(10 * implied_surge),
                supply=8,
                distance_km=row["distance_km"],
            )
        )
        sy.append(implied_surge - 1.0)
        # ETA target ~ distance * 3.5 minutes/km peak-adjusted
        minutes = max(5.0, row["distance_km"] * (3.8 if row["hour"] in (7, 8, 9, 16, 17, 18, 19) else 2.8))
        ex.append(eta_features(distance_km=row["distance_km"], hour=row["hour"], dow=row["dow"]))
        ey.append(minutes)

    surge_m = store.surge.batch_fit(sx, sy, epochs=epochs)
    eta_m = store.eta.batch_fit(ex, ey, epochs=epochs)

    # Match weights: reinforce distance/eta on completed trips with good ratings proxy
    for t in completed[:40]:
        store.match.reinforce(
            {
                "distance": 0.8,
                "eta": 0.7,
                "driver_rating": 0.9,
                "acceptance_rate": 0.85,
                "safety_score": 0.9,
                "vehicle_match": 0.7,
                "passenger_rating": 0.8,
                "preference_match": 0.5,
            },
            success=True,
            lr=0.01,
        )

    store.save()
    return {
        "ok": True,
        "trips_used": len(completed),
        "synthetic": 100,
        "surge": surge_m,
        "eta": eta_m,
        "match_weights": store.match.normalized(),
        "status": store.status(),
    }


def online_update_from_trip(
    *,
    distance_km: float,
    fare_cents: int,
    pickup_lat: float,
    pickup_lng: float,
    success: bool = True,
    ranking_factors: dict[str, float] | None = None,
) -> None:
    """Lightweight online update after a completed ride."""
    store = get_model_store()
    h = hour_bucket()
    d = dow()
    base = 15 + distance_km * 12
    fare = fare_cents / 100.0
    implied = max(1.0, min(3.5, fare / max(base, 1.0)))
    store.surge.update(
        surge_features(hour=h, dow=d, demand=int(10 * implied), supply=8, distance_km=distance_km),
        implied - 1.0,
    )
    minutes = max(5.0, distance_km * 3.2)
    store.eta.update(eta_features(distance_km=distance_km, hour=h, dow=d), minutes)
    if ranking_factors:
        store.match.reinforce(ranking_factors, success=success, lr=0.015)
    store.save()
