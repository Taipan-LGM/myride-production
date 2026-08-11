"""Predictive Suggestions Engine — learns rider patterns, pre-positions drivers.

Part 9.1 of the My Ride blueprint:
• Learns your routine: work, gym, home, social
• Suggests rides proactively: "Ready for your 8:30 commute?"
• Pre-positions drivers near predicted locations
• Reduces wait time to < 1 minute for repeat users
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from typing import Any, Optional

from app.models import TripStatus

logger = logging.getLogger(__name__)


@dataclass
class LocationPattern:
    """A learned location with typical usage times."""
    lat: float
    lng: float
    address: str | None = None
    # Times of day this location is visited (0-23 hour buckets)
    hour_frequencies: dict[int, int] = field(default_factory=dict)
    # How many times this location appears in trip history
    appearances: int = 0
    # Most recent visit timestamp
    last_visited: datetime | None = None


@dataclass
class CommutePattern:
    """Learned commute between two locations."""
    origin: LocationPattern
    destination: LocationPattern
    # Typical departure times (sorted)
    departure_hours: list[int] = field(default_factory=list)
    # Typical round-trip times in minutes
    roundtrip_duration_min: float = 30.0
    # How many days this pattern appears
    frequency_days: int = 0


@dataclass
class PredictiveSuggestion:
    """A suggestion ready to show the passenger."""
    type: str  # "commute", "frequent_destination", "nearby_favorite"
    message: str
    confidence: float  # 0.0 - 1.0
    eta_minutes: float
    estimated_fare_zar: float
    predicted_departure_hour: int | None = None


class PredictiveEngine:
    """Learns patterns from trip history and predicts future needs."""

    def __init__(self, db: Any):
        self._db = db
        self._location_cache: dict[str, LocationPattern] = {}
        self._commute_cache: dict[tuple[str, str], CommutePattern] = {}
        self._passenger_cache: dict[str, dict[str, Any]] = {}

    async def learn_from_trip(self, trip: dict[str, Any]) -> None:
        """Post a completed trip for learning."""
        if trip.get("status") != TripStatus.completed.value:
            return

        passenger_id = trip.get("passenger_id")
        if not passenger_id:
            return

        pickup = trip.get("pickup")
        dropoff = trip.get("dropoff")
        completed_at = trip.get("completed_at")

        if not pickup or not dropoff or not completed_at:
            return

        # Parse timestamp
        if isinstance(completed_at, str):
            completed_at = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))

        # Store locations
        pickup_loc = self._get_or_create_location(
            trip_id=f"{passenger_id}-{pickup}",
            lat=pickup.get("lat"),
            lng=pickup.get("lng"),
            timestamp=completed_at,
        )
        dropoff_loc = self._get_or_create_location(
            trip_id=f"{passenger_id}-{dropoff}",
            lat=dropoff.get("lat"),
            lng=dropoff.get("lng"),
            timestamp=completed_at,
        )

        if pickup_loc and dropoff_loc:
            self._update_commute_pattern(passenger_id, pickup_loc, dropoff_loc, completed_at)

    def _get_or_create_location(
        self,
        trip_id: str,
        lat: Optional[float],
        lng: Optional[float],
        timestamp: datetime,
    ) -> Optional[LocationPattern]:
        """Get or create a location pattern for a ride."""
        if lat is None or lng is None:
            return None

        # Create a simple location key (cluster lat/lng to ~100m)
        lat_key = round(lat * 1000) / 1000  # ~100m precision
        lng_key = round(lng * 1000) / 1000
        loc_key = f"{lat_key},{lng_key}"

        if loc_key in self._location_cache:
            loc = self._location_cache[loc_key]
        else:
            loc = LocationPattern(lat=lat_key, lng=lng_key)
            self._location_cache[loc_key] = loc

        # Update frequencies
        hour = timestamp.hour
        loc.hour_frequencies[hour] = loc.hour_frequencies.get(hour, 0) + 1
        loc.appearances += 1
        loc.last_visited = timestamp

        return loc

    def _update_commute_pattern(
        self,
        passenger_id: str,
        origin: LocationPattern,
        dest: LocationPattern,
        timestamp: datetime,
    ) -> None:
        """Track commute patterns between locations."""
        key = (f"{origin.lat},{origin.lng}", f"{dest.lat},{dest.lng}")

        if key not in self._commute_cache:
            pattern = CommutePattern(origin=origin, destination=dest)
        else:
            pattern = self._commute_cache[key]

        hour = timestamp.hour
        if hour not in pattern.departure_hours:
            pattern.departure_hours.append(hour)
        pattern.departure_hours.sort()
        pattern.frequency_days += 1
        if timestamp.date() not in getattr(pattern, "_dates", set()):
            pattern._dates = getattr(pattern, "_dates", set())
            pattern._dates.add(timestamp.date())

        self._commute_cache[key] = pattern

    async def get_suggestions(self, passenger_id: str, current_location: dict[str, float]) -> list[PredictiveSuggestion]:
        """Get predictive suggestions for a passenger."""
        suggestions = []

        if not self._passenger_cache.get(passenger_id):
            return suggestions

        patterns = self._passenger_cache[passenger_id]
        commutes = patterns.get("commutes", [])
        locations = patterns.get("locations", {})

        # Find typical commutes based on time of day
        now = datetime.now()
        current_hour = now.hour

        for pattern in commutes[:5]:  # Top 5 patterns
            # Check if this is a typical departure time
            if current_hour in pattern.departure_hours:
                suggestions.append(
                    PredictiveSuggestion(
                        type="commute",
                        message=f"Ready for your {self._describe_route(pattern.origin, pattern.destination)} commute?",
                        confidence=min(0.9, pattern.frequency_days / 10.0),
                        eta_minutes=3.0,  # Pre-positioned driver
                        estimated_fare_zar=25.00,
                        predicted_departure_hour=current_hour,
                    )
                )

        # Check for frequent destinations (e.g., "You're near your favorite spot")
        if current_location:
            near_favorites = self._find_nearby_favorites(
                locations, current_location, radius_km=1.0
            )
            for loc_id in near_favorites[:2]:
                loc = locations.get(loc_id)
                if loc:
                    suggestions.append(
                        PredictiveSuggestion(
                            type="frequent_destination",
                            message=f"Nearby: {loc.address or 'familiar area'}",
                            confidence=0.7,
                            eta_minutes=2.0,
                            estimated_fare_zar=18.00,
                        )
                    )

        return suggestions

    def _describe_route(self, origin: LocationPattern, dest: LocationPattern) -> str:
        """Generate a simple route description."""
        if dest.address:
            return f"to {dest.address}"
        return "home → work" if dest.hour_frequencies else "work"

    def _find_nearby_favorites(
        self,
        locations: dict[str, LocationPattern],
        current: dict[str, float],
        radius_km: float,
    ) -> list[str]:
        """Find locations within radius of current position."""
        nearby = []
        for loc_id, loc in locations.items():
            dist = self._haversine_km(current["lat"], current["lng"], loc.lat, loc.lng)
            if dist <= radius_km:
                nearby.append(loc_id)
        return nearby

    def _haversine_km(self, lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        """Calculate distance in km between two points."""
        from math import radians, sin, cos, sqrt, atan2

        R = 6371  # Earth radius in km
        dlat = radians(lat2 - lat1)
        dlng = radians(lng2 - lng1)
        a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng/2)**2
        c = 2 * atan2(sqrt(a), sqrt(1-a))
        return R * c

    async def preposition_drivers(self, location: dict[str, float], predicted_demand: float) -> list[str]:
        """Find drivers to pre-position near a predicted hot location."""
        # This would integrate with the Smart Router to find available drivers
        # For now, return placeholder suggesting where drivers should go
        return ["driver-demo-001", "driver-demo-002"]

    async def build_history(self, passenger_id: str) -> None:
        """Build passenger pattern history from completed trips."""
        # This would query FirestoreDB for trips
        # For MVP, we'll build a minimal history
        pass


# Global engine instance (singleton pattern, like ObservabilityStore)
_engine: PredictiveEngine | None = None
_db_instance = None


def get_predictive_engine(db: Any = None) -> PredictiveEngine:
    """Get the singleton predictive engine instance."""
    global _engine, _db_instance
    if _engine is None:
        _engine = PredictiveEngine(db)
        _db_instance = db
    return _engine


def reset_predictive_engine() -> None:
    """Reset for testing."""
    global _engine, _db_instance
    _engine = None
    _db_instance = None


# Convenience function for endpoints
async def get_predictions(passenger_id: str, current_location: dict[str, float], db: Any) -> list[dict[str, Any]]:
    """Get predictive suggestions as dicts for API response."""
    engine = get_predictive_engine(db)
    suggestions = await engine.get_suggestions(passenger_id, current_location)
    return [
        {
            "type": s.type,
            "message": s.message,
            "confidence": round(s.confidence, 2),
            "eta_minutes": s.eta_minutes,
            "estimated_fare_zar": s.estimated_fare_zar,
        }
        for s in suggestions
    ]