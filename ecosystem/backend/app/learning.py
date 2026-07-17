"""Learn layer stubs: predictive pickup suggestions + daily driver insights."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from app.firestore_db import FirestoreDB
from app.models import TripStatus


@dataclass
class RideSuggestion:
    title: str
    pickup_label: str
    dropoff_label: str
    pickup: dict[str, float]
    dropoff: dict[str, float]
    reason: str
    confidence: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DriverInsight:
    driver_id: str
    headline: str
    bullets: list[str]
    suggested_zone: str
    generated_at: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# SA commute patterns (heuristic until model training)
_COMMUTE_PATTERNS = [
    RideSuggestion(
        title="Ready for your CBD commute?",
        pickup_label="Home / Suburb",
        dropoff_label="Cape Town CBD",
        pickup={"lat": -33.9800, "lng": 18.4650},
        dropoff={"lat": -33.9249, "lng": 18.4241},
        reason="Morning peak · learned from weekday patterns",
        confidence=0.78,
    ),
    RideSuggestion(
        title="Airport run?",
        pickup_label="Cape Town CBD",
        dropoff_label="Cape Town Airport",
        pickup={"lat": -33.9249, "lng": 18.4241},
        dropoff={"lat": -33.9640, "lng": 18.6030},
        reason="Frequent Friday afternoon destination",
        confidence=0.66,
    ),
    RideSuggestion(
        title="Sandton after work?",
        pickup_label="Johannesburg CBD",
        dropoff_label="Sandton",
        pickup={"lat": -26.2041, "lng": 28.0473},
        dropoff={"lat": -26.1076, "lng": 28.0567},
        reason="Evening demand corridor",
        confidence=0.71,
    ),
]


async def predictive_suggestions(user_id: str, db: FirestoreDB | None = None) -> list[dict[str, Any]]:
    hour = datetime.now().hour
    suggestions = list(_COMMUTE_PATTERNS)
    if 6 <= hour <= 10:
        ordered = sorted(suggestions, key=lambda s: 0 if "commute" in s.title.lower() else 1)
    elif 15 <= hour <= 20:
        ordered = sorted(
            suggestions,
            key=lambda s: 0 if "Airport" in s.dropoff_label or "Sandton" in s.dropoff_label else 1,
        )
    else:
        ordered = suggestions
    result: list[RideSuggestion] = list(ordered)
    if db:
        trips = await db.list_trips_for_rider(user_id, limit=5)
        if trips:
            last = trips[0]
            pickup = last.pickup.model_dump() if hasattr(last.pickup, "model_dump") else dict(last.pickup)
            dropoff = last.dropoff.model_dump() if hasattr(last.dropoff, "model_dump") else dict(last.dropoff)
            result.insert(
                0,
                RideSuggestion(
                    title="Repeat your last trip?",
                    pickup_label=last.pickup_address or "Last pickup",
                    dropoff_label=last.dropoff_address or "Last dropoff",
                    pickup=pickup,
                    dropoff=dropoff,
                    reason="Based on your recent My Ride history",
                    confidence=0.84,
                ),
            )
    return [s.to_dict() for s in result[:3]]


async def driver_daily_insights(driver_id: str, db: FirestoreDB) -> dict[str, Any]:
    trips = await db.list_trips(driver_id=driver_id, limit=50)
    completed = [t for t in trips if t.status == TripStatus.completed]
    earnings_cents = sum(int(t.fare_final_cents or t.fare_estimate_cents or 0) for t in completed)
    earnings = earnings_cents / 100.0
    avg = (earnings / len(completed)) if completed else 0.0
    insight = DriverInsight(
        driver_id=driver_id,
        headline=f"You earned R{earnings:.2f} across {len(completed)} completed trips",
        bullets=[
            f"Average fare R{avg:.2f}",
            "Acceptance tip: stay online near CBD 07:00–09:00 for higher match scores",
            "Passengers rate clean cars higher — keep 5★ streak",
            "Try East side / airport corridor 16:00–19:00 — high demand",
        ],
        suggested_zone="Cape Town CBD → Airport corridor",
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
    return insight.to_dict()
