"""Real-time trip safety monitoring from telemetry snapshots."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any

from app.observability import get_observability


class SafetyAlertType(str, Enum):
    ROUTE_DEVIATION = "route_deviation"
    UNUSUAL_SPEED = "unusual_speed"
    UNEXPECTED_STOP = "unexpected_stop"


@dataclass
class SafetyAlert:
    alert_type: SafetyAlertType
    trip_id: str
    message: str
    severity: str  # low | medium | high

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["alert_type"] = self.alert_type.value
        return data


class SafetyMonitor:
    ROUTE_DEVIATION_THRESHOLD = 0.3
    SPEED_KMH_THRESHOLD = 120
    STOP_MINUTES_THRESHOLD = 5

    async def evaluate(self, telemetry: dict[str, Any]) -> list[SafetyAlert]:
        trip_id = str(telemetry.get("trip_id") or "unknown")
        alerts: list[SafetyAlert] = []

        deviation = float(telemetry.get("route_deviation") or 0)
        if deviation > self.ROUTE_DEVIATION_THRESHOLD:
            alerts.append(
                SafetyAlert(
                    alert_type=SafetyAlertType.ROUTE_DEVIATION,
                    trip_id=trip_id,
                    message=f"Route deviation {deviation:.0%} exceeds safe corridor.",
                    severity="high" if deviation > 0.5 else "medium",
                )
            )

        speed = float(telemetry.get("speed_kmh") or 0)
        if speed > self.SPEED_KMH_THRESHOLD:
            alerts.append(
                SafetyAlert(
                    alert_type=SafetyAlertType.UNUSUAL_SPEED,
                    trip_id=trip_id,
                    message=f"Unusual speed {speed:.0f} km/h detected.",
                    severity="high",
                )
            )

        unexpected_stop = bool(telemetry.get("unexpected_stop"))
        stop_mins = float(telemetry.get("stop_duration_minutes") or 0)
        if unexpected_stop and stop_mins > self.STOP_MINUTES_THRESHOLD:
            alerts.append(
                SafetyAlert(
                    alert_type=SafetyAlertType.UNEXPECTED_STOP,
                    trip_id=trip_id,
                    message=f"Unexpected stop lasting {stop_mins:.0f} minutes.",
                    severity="medium",
                )
            )

        if alerts:
            get_observability().record_safety(alerts)
        return alerts
