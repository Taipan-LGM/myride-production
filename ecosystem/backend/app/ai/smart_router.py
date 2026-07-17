"""ML-style multi-factor driver–passenger matching (rule-weighted scoring)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.geofire import filter_nearby_drivers, haversine_km
from app.models import DriverProfile, GeoPoint

logger = logging.getLogger(__name__)


@dataclass
class RideContext:
    pickup: GeoPoint
    dropoff: GeoPoint
    vehicle_type: str = "standard"
    passenger_rating: float = 5.0
    passenger_preferences: dict[str, Any] = field(default_factory=dict)
    surge_factor: float = 1.0
    radius_km: float = 10.0


@dataclass
class DriverScore:
    driver_id: str
    driver_name: str
    score: float
    ranking_factors: dict[str, float]
    vehicle_type: str
    eta_seconds: int
    distance_km: float
    surge_multiplier: float
    price_estimate: float


class SmartRouter:
    """Multi-factor matching engine. Works with in-memory / Firestore DriverProfiles."""

    WEIGHTS = {
        "distance": 0.25,
        "eta": 0.20,
        "driver_rating": 0.15,
        "acceptance_rate": 0.10,
        "passenger_rating": 0.05,
        "vehicle_match": 0.10,
        "safety_score": 0.10,
        "preference_match": 0.05,
    }

    def __init__(self, search_limit: int = 50) -> None:
        self.search_limit = search_limit

    def _active_weights(self) -> dict[str, float]:
        try:
            from app.ml.store import learned_match_weights

            return learned_match_weights()
        except Exception:
            return self.WEIGHTS

    async def find_best_drivers(
        self,
        context: RideContext,
        drivers: list[DriverProfile],
        top_n: int = 3,
        min_score: float = 0.30,
        driver_meta: dict[str, dict[str, Any]] | None = None,
    ) -> list[DriverScore]:
        nearby = filter_nearby_drivers(
            drivers,
            context.pickup,
            context.radius_km,
            limit=self.search_limit,
        )
        if not nearby:
            logger.warning("No available drivers near pickup")
            return []

        meta = driver_meta or {}
        scored: list[DriverScore] = []
        for item in nearby:
            score = await self._score_driver(item.driver, item.distance_km, context, meta.get(item.driver.id, {}))
            if score.score >= min_score:
                scored.append(score)

        scored.sort(key=lambda s: s.score, reverse=True)
        return scored[:top_n]

    async def _score_driver(
        self,
        driver: DriverProfile,
        distance_km: float,
        context: RideContext,
        meta: dict[str, Any],
    ) -> DriverScore:
        weights = self._active_weights()
        factors: dict[str, float] = {}

        distance_raw = self._logistic_decay(distance_km, max_val=2.0)
        factors["distance"] = distance_raw

        eta_seconds = self._estimate_eta_seconds(distance_km)
        eta_raw = self._logistic_decay(eta_seconds / 60.0, max_val=5.0)
        factors["eta"] = eta_raw

        factors["driver_rating"] = min(1.0, max(0.0, (driver.rating or 5.0) / 5.0))

        acceptance = float(meta.get("acceptance_rate", 95.0))
        factors["acceptance_rate"] = min(1.0, max(0.0, acceptance / 100.0))

        factors["passenger_rating"] = min(1.0, max(0.0, context.passenger_rating / 5.0))

        vehicle_type = str(meta.get("vehicle_type") or driver.vehicle_make or "standard").lower()
        requested = context.vehicle_type.lower()
        factors["vehicle_match"] = 1.0 if vehicle_type == requested else 0.5

        safety = float(meta.get("safety_score", 90.0))
        factors["safety_score"] = min(1.0, max(0.0, safety / 100.0))

        factors["preference_match"] = self._preference_match(meta, context)

        total = sum(factors[k] * weights.get(k, self.WEIGHTS.get(k, 0.0)) for k in factors)
        total = max(0.0, min(1.0, total))

        trip_distance = haversine_km(context.pickup, context.dropoff)
        price_estimate = round((15.0 + trip_distance * 12.0) * context.surge_factor, 2)

        return DriverScore(
            driver_id=driver.id,
            driver_name=driver.name,
            score=round(total, 4),
            ranking_factors={k: round(v, 4) for k, v in factors.items()},
            vehicle_type=vehicle_type,
            eta_seconds=int(eta_seconds),
            distance_km=round(distance_km, 2),
            surge_multiplier=context.surge_factor,
            price_estimate=price_estimate,
        )

    def _estimate_eta_seconds(self, distance_km: float) -> float:
        try:
            from app.ml.store import predict_eta_seconds

            return predict_eta_seconds(distance_km)
        except Exception:
            traffic = self._traffic_factor()
            speed_kmh = max(8.0, 30.0 / traffic)
            return max(60.0, (distance_km / speed_kmh) * 3600.0)

    @staticmethod
    def _traffic_factor() -> float:
        hour = datetime.now().hour
        if 7 <= hour <= 9 or 16 <= hour <= 19:
            return 1.4
        if 11 <= hour <= 13:
            return 1.0
        return 0.85

    @staticmethod
    def _preference_match(meta: dict[str, Any], context: RideContext) -> float:
        score = 0.5
        preferred = meta.get("preferred_zones") or []
        if preferred:
            # Soft match: preference list present → slight boost
            score += 0.15
        prefs = context.passenger_preferences or {}
        if prefs.get("quiet") and meta.get("quiet_rides"):
            score += 0.2
        return min(1.0, score)

    @staticmethod
    def _logistic_decay(value: float, max_val: float = 10.0) -> float:
        if value <= 0:
            return 1.0
        return 1.0 / (1.0 + (value / max_val) ** 2)
