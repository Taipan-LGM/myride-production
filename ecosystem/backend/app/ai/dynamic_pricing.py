"""Dynamic pricing with ZAR rates + lightweight epsilon-greedy surge optimization."""

from __future__ import annotations

import logging
import random
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

from app.redis_cache import RedisCache

logger = logging.getLogger(__name__)


@dataclass
class FareBreakdown:
    base_fare: float
    distance_km: float
    duration_minutes: int
    per_km_rate: float
    per_minute_rate: float
    surge_multiplier: float
    traffic_multiplier: float
    weather_multiplier: float
    event_multiplier: float
    toll_charges: float
    discount_applied: float
    platform_fee: float
    total: float
    currency: str = "ZAR"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def total_cents(self) -> int:
        return int(round(self.total * 100))


class DynamicPricingEngine:
    """Rule + RL-stub surge pricing for South Africa (ZAR)."""

    BASE_FARE = 15.00
    PER_KM_RATE = 12.00
    PER_MINUTE_RATE = 2.00
    MINIMUM_FARE = 25.00
    PLATFORM_FEE_PERCENT = 0.15

    MIN_SURGE = 1.0
    MAX_SURGE = 5.0
    # Exploration off by default so fares are stable; raise for live learning experiments
    EPSILON = 0.0

    TIER_DISCOUNTS = {
        "bronze": 0.0,
        "silver": 0.03,
        "gold": 0.07,
        "platinum": 0.12,
    }

    def __init__(self, cache: RedisCache | None = None, epsilon: float | None = None) -> None:
        self.cache = cache
        self.epsilon = self.EPSILON if epsilon is None else epsilon
        self._zone_metrics: dict[str, tuple[int, int]] = {}
        self._q_table: dict[str, dict[float, float]] = defaultdict(dict)

    def set_zone_metrics(self, zone_id: str, demand: int, supply: int) -> None:
        self._zone_metrics[zone_id] = (demand, supply)

    async def calculate_fare(
        self,
        pickup_lat: float,
        pickup_lng: float,
        dropoff_lat: float,
        dropoff_lng: float,
        distance_km: float,
        duration_minutes: int,
        loyalty_tier: str = "bronze",
        vehicle_type: str = "standard",
    ) -> FareBreakdown:
        zone_id = self._zone_id(pickup_lat, pickup_lng)
        surge = await self._calculate_surge(zone_id)
        traffic = self._traffic_multiplier()
        weather = 1.0
        event = 1.0
        loyalty = self.TIER_DISCOUNTS.get((loyalty_tier or "bronze").lower(), 0.0)

        vehicle_bump = 1.0
        if vehicle_type.lower() in ("premium", "luxury"):
            vehicle_bump = 1.35
        elif vehicle_type.lower() == "van":
            vehicle_bump = 1.2

        subtotal = self.BASE_FARE + distance_km * self.PER_KM_RATE + duration_minutes * self.PER_MINUTE_RATE
        subtotal *= surge * traffic * weather * event * vehicle_bump
        discount = subtotal * loyalty
        subtotal -= discount
        platform_fee = subtotal * self.PLATFORM_FEE_PERCENT
        total = subtotal + platform_fee
        if total < self.MINIMUM_FARE:
            total = self.MINIMUM_FARE
        total = round(total * 2) / 2  # nearest R0.50

        return FareBreakdown(
            base_fare=self.BASE_FARE,
            distance_km=round(distance_km, 2),
            duration_minutes=duration_minutes,
            per_km_rate=self.PER_KM_RATE,
            per_minute_rate=self.PER_MINUTE_RATE,
            surge_multiplier=round(surge, 2),
            traffic_multiplier=round(traffic, 2),
            weather_multiplier=weather,
            event_multiplier=event,
            toll_charges=0.0,
            discount_applied=round(discount, 2),
            platform_fee=round(platform_fee, 2),
            total=total,
            currency="ZAR",
        )

    async def _calculate_surge(self, zone_id: str) -> float:
        demand, supply = await self._supply_demand(zone_id)
        if supply <= 0:
            ratio = 10.0
        else:
            ratio = demand / max(supply, 1)
        base_surge = 1.0 + max(0.0, ratio - 1.0) * 0.3
        base_surge = max(self.MIN_SURGE, min(self.MAX_SURGE, base_surge))
        # Part 12: trained residual model (online SGD) blends with RL-stub
        try:
            from app.ml.store import predict_surge_multiplier

            hour = datetime.now().hour
            trained = predict_surge_multiplier(
                base_surge=base_surge,
                hour=hour,
                dow=datetime.now().weekday(),
                demand=demand,
                supply=supply,
            )
            base_surge = 0.55 * base_surge + 0.45 * trained
        except Exception as exc:
            logger.debug("ML surge skipped: %s", exc)
        return await self._rl_optimize_surge(zone_id, base_surge, demand, supply)

    async def _rl_optimize_surge(
        self,
        zone_id: str,
        base_surge: float,
        demand: int,
        supply: int,
    ) -> float:
        state = self._state_key(zone_id, demand, supply)
        current_q = self._q_table.get(state, {})
        if self.epsilon > 0 and random.random() < self.epsilon:
            surge = random.uniform(
                max(self.MIN_SURGE, base_surge - 0.2),
                min(self.MAX_SURGE, base_surge + 0.5),
            )
        elif current_q:
            surge = max(current_q.items(), key=lambda x: x[1])[0]
        else:
            surge = base_surge
        return max(self.MIN_SURGE, min(self.MAX_SURGE, round(surge, 2)))

    async def _supply_demand(self, zone_id: str) -> tuple[int, int]:
        if zone_id in self._zone_metrics:
            return self._zone_metrics[zone_id]
        if self.cache and self.cache.enabled:
            data = await self.cache.get_json(f"zone:{zone_id}:metrics")
            if isinstance(data, dict):
                return int(data.get("demand", 5)), int(data.get("supply", 3))
        return 5, 3

    @staticmethod
    def _zone_id(lat: float, lng: float) -> str:
        return f"zone_{round(lat, 2)}_{round(lng, 2)}"

    @staticmethod
    def _state_key(zone_id: str, demand: int, supply: int) -> str:
        return f"{zone_id}:{min(5, demand // 10)}:{min(5, supply // 5)}"

    @staticmethod
    def _traffic_multiplier() -> float:
        hour = datetime.now().hour
        if 7 <= hour <= 9 or 16 <= hour <= 19:
            return 1.4
        if 11 <= hour <= 13:
            return 1.0
        return 0.8

    async def persist_q_table(self) -> None:
        if not self.cache or not self.cache.enabled:
            return
        payload = {
            state: {str(action): q for action, q in actions.items()}
            for state, actions in self._q_table.items()
        }
        await self.cache.set_json("pricing:q_table", payload, ttl_seconds=86400 * 7)

    async def load_q_table(self) -> None:
        if not self.cache or not self.cache.enabled:
            return
        data = await self.cache.get_json("pricing:q_table")
        if not isinstance(data, dict):
            return
        try:
            for state, actions in data.items():
                for action, q_value in actions.items():
                    self._q_table[state][float(action)] = float(q_value)
        except (TypeError, ValueError) as exc:
            logger.warning("Failed to load Q-table: %s", exc)
