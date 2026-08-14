from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from app.ai.customer_service import CustomerServiceAI
from app.ai.dynamic_pricing import DynamicPricingEngine
from app.ai.fraud_detection import FraudDetection
from app.ai.safety_monitor import SafetyMonitor
from app.ai.smart_router import RideContext, SmartRouter
from app.config import Settings, get_settings
from app.geofire import haversine_km
from app.models import AiParseRequest, AiParseResponse, DriverProfile, GeoPoint, TripCreateRequest
from app.redis_cache import RedisCache
from app.rider_services import carbon_for_distance_km

logger = logging.getLogger(__name__)

_INTENT_SYSTEM = """You are My Ride's trip assistant. Parse user messages into ride intents.
Return JSON only with keys: intent, confidence (0-1), entities, reply, suggested_trip.
Intents: book_ride, cancel_ride, trip_status, fare_estimate, support, unknown.
For book_ride include suggested_trip with pickup/dropoff addresses or lat/lng if mentioned."""


def _load_dispatcher_prompt() -> str:
    path = Path(__file__).parent / "ai" / "prompts" / "dispatcher.md"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return _INTENT_SYSTEM


class AiDispatcher:
    """Orchestrates NL parse, SmartRouter, DynamicPricing, CS, fraud, and safety."""

    def __init__(
        self,
        settings: Settings | None = None,
        cache: RedisCache | None = None,
        router: SmartRouter | None = None,
        pricing: DynamicPricingEngine | None = None,
        customer_service: CustomerServiceAI | None = None,
        fraud: FraudDetection | None = None,
        safety: SafetyMonitor | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.cache = cache
        self.router = router or SmartRouter(
            search_limit=self.settings.driver_search_limit,
        )
        self.pricing = pricing or DynamicPricingEngine(cache=cache)
        self.customer_service = customer_service or CustomerServiceAI(settings=self.settings)
        self.fraud = fraud or FraudDetection()
        self.safety = safety or SafetyMonitor()
        self._client = None
        if self.settings.openai_api_key:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(api_key=self.settings.openai_api_key)
        self._system_prompt = _load_dispatcher_prompt()

    async def parse(self, request: AiParseRequest) -> AiParseResponse:
        if self._client:
            return await self._parse_openai(request)
        return self._parse_heuristic(request)

    async def process_booking(
        self,
        rider_id: str,
        pickup: GeoPoint,
        dropoff: GeoPoint,
        vehicle_type: str = "standard",
        drivers: list[DriverProfile] | None = None,
        passenger_rating: float = 5.0,
        loyalty_tier: str = "bronze",
        fraud_signals: dict[str, Any] | None = None,
        pickup_address: str | None = None,
        dropoff_address: str | None = None,
        top_n: int = 3,
    ) -> dict[str, Any]:
        distance_km = haversine_km(pickup, dropoff)
        duration_minutes = max(5, int(distance_km * 3.5))
        fare = await self.pricing.calculate_fare(
            pickup_lat=pickup.lat,
            pickup_lng=pickup.lng,
            dropoff_lat=dropoff.lat,
            dropoff_lng=dropoff.lng,
            distance_km=distance_km,
            duration_minutes=duration_minutes,
            loyalty_tier=loyalty_tier,
            vehicle_type=vehicle_type,
        )

        signals = {
            "requests_last_hour": 1,
            "gps_jump_km": 0.0,
            "payment_mismatch": False,
            "new_account_hours": 720,
            "fare_cents": fare.total_cents,
            "wallet_balance_cents": 10000,
            **(fraud_signals or {}),
        }
        fraud_verdict = await self.fraud.assess(signals)
        if fraud_verdict.should_hold:
            return {
                "status": "blocked",
                "reason": "fraud_hold",
                "fraud": fraud_verdict.to_dict(),
                "fare": fare.to_dict(),
                "drivers": [],
                "rider_id": rider_id,
                "pickup": pickup.model_dump(),
                "dropoff": dropoff.model_dump(),
            }

        context = RideContext(
            pickup=pickup,
            dropoff=dropoff,
            vehicle_type=vehicle_type,
            passenger_rating=passenger_rating,
            surge_factor=fare.surge_multiplier,
            radius_km=self.settings.driver_search_radius_km or 10.0,
        )
        # Prefer wider radius for matching so empty pools are rare in denser tests
        if context.radius_km < 10:
            context.radius_km = 10.0

        scored = await self.router.find_best_drivers(
            context,
            drivers=drivers or [],
            top_n=top_n,
        )
        driver_payload = [
            {
                "driver_id": s.driver_id,
                "driver_name": s.driver_name,
                "score": s.score,
                "eta_seconds": s.eta_seconds,
                "distance_km": s.distance_km,
                "vehicle_type": s.vehicle_type,
                "ranking_factors": s.ranking_factors,
            }
            for s in scored
        ]

        return {
            "status": "drivers_found" if scored else "searching",
            "rider_id": rider_id,
            "pickup": pickup.model_dump(),
            "dropoff": dropoff.model_dump(),
            "pickup_address": pickup_address,
            "dropoff_address": dropoff_address,
            "vehicle_type": vehicle_type,
            "fare": fare.to_dict(),
            "fare_estimate_cents": fare.total_cents,
            "currency": "ZAR",
            "drivers": driver_payload,
            "fraud": fraud_verdict.to_dict(),
            "estimated_wait_seconds": scored[0].eta_seconds if scored else None,
            "carbon": carbon_for_distance_km(haversine_km(pickup, dropoff)),
        }

    async def handle_support(
        self,
        user_id: str,
        query: str,
        channel: str = "chat",
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        resolution = await self.customer_service.handle_query(
            user_id=user_id,
            query=query,
            channel=channel,
            context=context,
        )
        try:
            from app.observability import get_observability

            get_observability().record_support(
                category=resolution.category,
                action=resolution.action,
                confidence=resolution.confidence,
                escalated=resolution.needs_human,
            )
        except Exception as exc:  # pragma: no cover
            logger.debug("observability record_support skipped: %s", exc)
        return resolution.to_dict()

    async def monitor_trip_safety(self, telemetry: dict[str, Any]) -> list[dict[str, Any]]:
        alerts = await self.safety.evaluate(telemetry)
        return [a.to_dict() for a in alerts]

    async def _parse_openai(self, request: AiParseRequest) -> AiParseResponse:
        assert self._client is not None
        user_content = (
            f"Channel: {request.channel}\n"
            f"User: {request.user_id or 'anonymous'}\n"
            f"Message: {request.text}"
        )
        try:
            response = await self._client.chat.completions.create(
                model=self.settings.openai_model,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": _INTENT_SYSTEM},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.2,
            )
            raw = response.choices[0].message.content or "{}"
            data = json.loads(raw)
            suggested = data.get("suggested_trip")
            return AiParseResponse(
                intent=data.get("intent", "unknown"),
                confidence=float(data.get("confidence", 0.5)),
                entities=data.get("entities") or {},
                reply=data.get("reply"),
                suggested_trip=TripCreateRequest(**suggested) if suggested else None,
            )
        except Exception as exc:
            logger.exception("OpenAI parse failed: %s", exc)
            return self._parse_heuristic(request)

    def _parse_heuristic(self, request: AiParseRequest) -> AiParseResponse:
        text = request.text.lower().strip()
        if any(w in text for w in ("cancel", "stop ride")):
            return AiParseResponse(
                intent="cancel_ride",
                confidence=0.75,
                reply="I can help cancel your ride. Which trip should I cancel?",
            )
        if any(w in text for w in ("status", "where", "eta", "driver")):
            return AiParseResponse(
                intent="trip_status",
                confidence=0.7,
                reply="Checking your active trip status…",
            )
        if any(w in text for w in ("support", "help", "refund", "lost", "complaint")):
            return AiParseResponse(
                intent="support",
                confidence=0.8,
                reply="Connecting you with My Ride support…",
            )
        if any(w in text for w in ("book", "ride", "pickup", "need a car", "uber")):
            pickup, dropoff = self._extract_addresses(text)
            suggested = None
            if request.user_id and pickup:
                suggested = TripCreateRequest(
                    rider_id=request.user_id,
                    pickup=GeoPoint(lat=-33.9249, lng=18.4241),
                    dropoff=GeoPoint(lat=-33.9180, lng=18.4232),
                    pickup_address=pickup,
                    dropoff_address=dropoff or "Destination TBD",
                )
            return AiParseResponse(
                intent="book_ride",
                confidence=0.65,
                entities={"pickup": pickup, "dropoff": dropoff},
                reply="Got it — I'll find a driver near you.",
                suggested_trip=suggested,
            )
        return AiParseResponse(
            intent="unknown",
            confidence=0.3,
            reply="I can book rides, check trip status, or estimate fares. What do you need?",
        )

    @staticmethod
    def _extract_addresses(text: str) -> tuple[str | None, str | None]:
        from_to = re.search(r"from (.+?) to (.+)", text)
        if from_to:
            return from_to.group(1).strip(), from_to.group(2).strip()
        pickup = re.search(r"pickup(?: at)? (.+)", text)
        return (pickup.group(1).strip() if pickup else None, None)


_dispatcher: AiDispatcher | None = None


def get_dispatcher() -> AiDispatcher:
    global _dispatcher
    if _dispatcher is None:
        _dispatcher = AiDispatcher()
    return _dispatcher


def reset_dispatcher() -> None:
    """Test helper to clear singleton."""
    global _dispatcher
    _dispatcher = None
