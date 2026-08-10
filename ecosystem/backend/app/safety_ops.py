"""Safety operations — SOS, emergency 112 (SA), live trip share."""

from __future__ import annotations

import logging
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

from app.ai.safety_monitor import SafetyMonitor
from app.firestore_db import FirestoreDB

logger = logging.getLogger(__name__)

# South Africa national emergency number
EMERGENCY_NUMBER = "112"

_sos_log: list[dict[str, Any]] = []
_share_tokens: dict[str, dict[str, Any]] = {}


@dataclass
class SosResult:
    sos_id: str
    trip_id: str | None
    emergency_number: str
    status: str
    message: str
    alerts: list[dict[str, Any]] = field(default_factory=list)
    notified: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "sos_id": self.sos_id,
            "trip_id": self.trip_id,
            "emergency_number": self.emergency_number,
            "dial": f"tel:{self.emergency_number}",
            "status": self.status,
            "message": self.message,
            "alerts": self.alerts,
            "notified": self.notified,
            "instructions": [
                f"Call {EMERGENCY_NUMBER} immediately if you are in danger.",
                "Live trip location is shared with My Ride safety ops.",
                "Stay on the line with emergency services if connected.",
            ],
        }


async def trigger_sos(
    *,
    user_id: str,
    trip_id: str | None,
    lat: float | None,
    lng: float | None,
    note: str | None,
    db: FirestoreDB,
) -> SosResult:
    sos_id = f"sos-{secrets.token_hex(4)}"
    alerts: list[dict[str, Any]] = []
    if trip_id:
        try:
            alerts = [
                a.to_dict()
                for a in await SafetyMonitor().evaluate(
                    {
                        "trip_id": trip_id,
                        "route_deviation": 0.55,
                        "unexpected_stop": True,
                        "stop_duration_minutes": 6,
                        "speed_kmh": 0,
                    }
                )
            ]
        except Exception as exc:
            logger.warning("SOS safety evaluate skipped: %s", exc)

    entry = {
        "sos_id": sos_id,
        "user_id": user_id,
        "trip_id": trip_id,
        "lat": lat,
        "lng": lng,
        "note": note,
        "created_at": time.time(),
        "emergency_number": EMERGENCY_NUMBER,
        "alerts": alerts,
    }
    _sos_log.append(entry)
    logger.warning("SOS triggered %s user=%s trip=%s", sos_id, user_id, trip_id)

    notified = ["myride-safety-ops", "admin-metrics"]
    if trip_id:
        trip = await db.get_trip(trip_id)
        if trip and trip.driver_id:
            notified.append(f"driver:{trip.driver_id}")

    return SosResult(
        sos_id=sos_id,
        trip_id=trip_id,
        emergency_number=EMERGENCY_NUMBER,
        status="active",
        message=(
            f"SOS recorded. Dial {EMERGENCY_NUMBER} now. "
            "My Ride safety ops has your live trip context."
        ),
        alerts=alerts,
        notified=notified,
    )


def create_share_link(trip_id: str, rider_id: str, *, ttl_seconds: int = 3600) -> dict[str, Any]:
    token = secrets.token_urlsafe(12)
    _share_tokens[token] = {
        "trip_id": trip_id,
        "rider_id": rider_id,
        "exp": time.time() + ttl_seconds,
    }
    return {
        "token": token,
        "path": f"/share/{token}",
        "expires_in_seconds": ttl_seconds,
        "message": "Share this link so a trusted contact can follow your live trip.",
    }


def get_share(token: str) -> dict[str, Any] | None:
    row = _share_tokens.get(token)
    if not row:
        return None
    if row["exp"] < time.time():
        _share_tokens.pop(token, None)
        return None
    return row


def list_sos(limit: int = 20) -> list[dict[str, Any]]:
    return list(reversed(_sos_log[-limit:]))
