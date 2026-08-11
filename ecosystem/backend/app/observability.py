"""Live operational counters and observability snapshot.

The AI safety, fraud, and customer-service modules record every decision here.
The admin dashboard reads from ``snapshot()`` and subscribes via the
``/ws/ops`` WebSocket stream for live updates.

Counters are kept in process (lightweight, no DB round-trip per increment)
and are exposed via the public API:

- ``record_fraud(verdict)`` — called from fraud_detection.assess()
- ``record_safety(alerts)``  — called from safety_monitor.evaluate()
- ``record_support(resolution)`` — called from customer_service.handle_query()
- ``record_trip_lifecycle(status, channel)`` — called from extended_routes
- ``record_completion(duration_seconds, fare_cents)``
- ``snapshot(db)``            — full dashboard payload
- ``recent_events(kind, limit)`` — feed of last N raw events for the UI

The store is thread-safe (asyncio.Lock-guarded snapshots only; increments are
GIL-safe CPython dict ops) so it works whether the API serves requests in
threads or async tasks.

NOTE: Avoid importing AI dataclasses here at module top-level — the AI
modules import ``get_observability`` and a circular import would crash
during app boot. We import them lazily inside ``record_*`` methods instead.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Deque

logger = logging.getLogger(__name__)

SA_TZ = timezone(timedelta(hours=2))
MAX_RECENT_EVENTS = 200
MAX_RECENT_PER_KIND = 100


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class FraudEvent:
    verdict_score: float
    flagged: bool
    held: bool
    reasons: list[str]
    timestamp: str = field(default_factory=_utcnow_iso)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": "fraud",
            "score": self.verdict_score,
            "flagged": self.flagged,
            "held": self.held,
            "reasons": list(self.reasons),
            "timestamp": self.timestamp,
        }


@dataclass
class SafetyEvent:
    alert_type: str
    trip_id: str
    severity: str
    message: str
    timestamp: str = field(default_factory=_utcnow_iso)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": "safety",
            "alert_type": self.alert_type,
            "trip_id": self.trip_id,
            "severity": self.severity,
            "message": self.message,
            "timestamp": self.timestamp,
        }


@dataclass
class SupportEvent:
    category: str
    action: str
    confidence: float
    escalated: bool
    timestamp: str = field(default_factory=_utcnow_iso)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": "support",
            "category": self.category,
            "action": self.action,
            "confidence": self.confidence,
            "escalated": self.escalated,
            "timestamp": self.timestamp,
        }


@dataclass
class TripEvent:
    status: str
    channel: str | None
    duration_seconds: float | None
    fare_cents: int | None
    timestamp: str = field(default_factory=_utcnow_iso)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": "trip",
            "status": self.status,
            "channel": self.channel,
            "duration_seconds": self.duration_seconds,
            "fare_cents": self.fare_cents,
            "timestamp": self.timestamp,
        }


class ObservabilityStore:
    """Singleton counters + recent-event log used by the /ops/* surface."""

    def __init__(self) -> None:
        self._fraud_total = 0
        self._fraud_flagged = 0
        self._fraud_held = 0
        self._fraud_score_sum = 0.0

        self._safety_total = 0
        self._safety_by_type: Counter[str] = Counter()
        self._safety_by_severity: Counter[str] = Counter()

        self._support_total = 0
        self._support_escalated = 0
        self._support_resolved = 0
        self._support_confidence_sum = 0.0
        self._support_by_category: Counter[str] = Counter()
        self._support_by_action: Counter[str] = Counter()

        self._trips_total = 0
        self._trips_completed = 0
        self._trips_cancelled = 0
        self._trip_fare_sum_cents = 0
        self._trip_duration_sum = 0.0
        self._trip_duration_count = 0
        self._trips_by_channel: Counter[str] = Counter()

        # Rolling buckets for time-series charts (60 buckets, 1 minute each).
        self._minute_started = int(time.time() // 60)
        self._minute_buckets: dict[str, int] = {}

        self._recent: dict[str, Deque[dict[str, Any]]] = {
            "fraud": deque(maxlen=MAX_RECENT_PER_KIND),
            "safety": deque(maxlen=MAX_RECENT_PER_KIND),
            "support": deque(maxlen=MAX_RECENT_PER_KIND),
            "trip": deque(maxlen=MAX_RECENT_PER_KIND),
        }
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------ #
    # Recording API — called by AI / lifecycle modules.
    # ------------------------------------------------------------------ #

    def record_fraud(self, verdict: "FraudVerdict") -> None:  # type: ignore[name-defined]
        self._fraud_total += 1
        self._fraud_score_sum += float(verdict.score)
        if verdict.should_flag:
            self._fraud_flagged += 1
        if verdict.should_hold:
            self._fraud_held += 1
        self._bump_minute("fraud_assessed")
        ev = FraudEvent(
            verdict_score=float(verdict.score),
            flagged=bool(verdict.should_flag),
            held=bool(verdict.should_hold),
            reasons=list(verdict.reasons or []),
        )
        self._recent["fraud"].append(ev.to_dict())

    def record_safety(self, alerts: list["SafetyAlert"]) -> None:  # type: ignore[name-defined]
        if not alerts:
            return
        for alert in alerts:
            self._safety_total += 1
            self._safety_by_type[alert.alert_type.value] += 1
            self._safety_by_severity[str(alert.severity)] += 1
            self._bump_minute(f"safety_{alert.alert_type.value}")
            ev = SafetyEvent(
                alert_type=alert.alert_type.value,
                trip_id=alert.trip_id,
                severity=str(alert.severity),
                message=alert.message,
            )
            self._recent["safety"].append(ev.to_dict())

    def record_support(
        self,
        category: "IssueCategory | str",  # type: ignore[name-defined]
        action: "ResolutionAction | str",  # type: ignore[name-defined]
        confidence: float,
        escalated: bool,
    ) -> None:
        from app.ai.customer_service import IssueCategory, ResolutionAction

        cat = category.value if isinstance(category, IssueCategory) else str(category)
        act = action.value if isinstance(action, ResolutionAction) else str(action)
        self._support_total += 1
        self._support_confidence_sum += float(confidence)
        if escalated:
            self._support_escalated += 1
        elif act != ResolutionAction.ESCALATE_HUMAN.value:
            self._support_resolved += 1
        self._support_by_category[cat] += 1
        self._support_by_action[act] += 1
        self._bump_minute("support_handled")
        ev = SupportEvent(
            category=cat,
            action=act,
            confidence=float(confidence),
            escalated=bool(escalated),
        )
        self._recent["support"].append(ev.to_dict())

    def record_trip_lifecycle(
        self,
        status: str,
        *,
        channel: str | None = None,
        duration_seconds: float | None = None,
        fare_cents: int | None = None,
    ) -> None:
        from app.models import TripStatus

        self._trips_total += 1
        if status == TripStatus.completed.value:
            self._trips_completed += 1
            if fare_cents is not None and fare_cents >= 0:
                self._trip_fare_sum_cents += int(fare_cents)
        elif status == TripStatus.cancelled.value:
            self._trips_cancelled += 1
        if duration_seconds is not None and duration_seconds >= 0:
            self._trip_duration_sum += float(duration_seconds)
            self._trip_duration_count += 1
        if channel:
            self._trips_by_channel[str(channel)] += 1
        self._bump_minute("trip_lifecycle")
        ev = TripEvent(
            status=status,
            channel=channel,
            duration_seconds=duration_seconds,
            fare_cents=fare_cents,
        )
        self._recent["trip"].append(ev.to_dict())

    def record_completion(
        self,
        duration_seconds: float | None,
        fare_cents: int | None,
        channel: str | None = None,
    ) -> None:
        from app.models import TripStatus

        self.record_trip_lifecycle(
            TripStatus.completed.value,
            channel=channel,
            duration_seconds=duration_seconds,
            fare_cents=fare_cents,
        )

    # ------------------------------------------------------------------ #
    # Snapshot — the full payload the admin UI consumes.
    # ------------------------------------------------------------------ #

    async def snapshot(self, db: Any | None = None) -> dict[str, Any]:
        async with self._lock:
            counts = self._counts()
            support_rate = (
                100.0 * self._support_resolved / self._support_total
                if self._support_total
                else 0.0
            )
            avg_fraud = (
                self._fraud_score_sum / self._fraud_total
                if self._fraud_total
                else 0.0
            )
            avg_fare_cents = (
                self._trip_fare_sum_cents / self._trips_completed
                if self._trips_completed
                else 0
            )
            avg_duration = (
                self._trip_duration_sum / self._trip_duration_count
                if self._trip_duration_count
                else 0.0
            )
            ai_resolution_rate = round(support_rate, 1)
            avg_fraud_score = round(avg_fraud, 3)
            avg_fare_zar = round(avg_fare_cents / 100.0, 2)
            avg_duration_min = round(avg_duration / 60.0, 2)

            live_block: dict[str, Any] = {}
            if db is not None:
                try:
                    live_block = await self._live_block(db)
                except Exception as exc:  # pragma: no cover - DB transient
                    logger.debug("live_block skipped: %s", exc)

            return {
                "generated_at": _utcnow_iso(),
                "ai_resolution_rate": ai_resolution_rate,
                "ai_resolution_target": 95.0,
                "ai_resolution_alert": ai_resolution_rate < 90.0,
                "fraud": {
                    "total_assessments": self._fraud_total,
                    "flagged": self._fraud_flagged,
                    "held": self._fraud_held,
                    "avg_score": avg_fraud_score,
                    "by_reason": self._fraud_reason_breakdown(),
                },
                "safety": {
                    "total_alerts": self._safety_total,
                    "by_type": dict(self._safety_by_type),
                    "by_severity": dict(self._safety_by_severity),
                },
                "support": {
                    "total": self._support_total,
                    "resolved": self._support_resolved,
                    "escalated": self._support_escalated,
                    "avg_confidence": round(
                        self._support_confidence_sum / self._support_total, 3
                    )
                    if self._support_total
                    else 0.0,
                    "by_category": dict(self._support_by_category),
                    "by_action": dict(self._support_by_action),
                },
                "trips": {
                    "total": self._trips_total,
                    "completed": self._trips_completed,
                    "cancelled": self._trips_cancelled,
                    "completion_rate": round(
                        100.0 * self._trips_completed / self._trips_total, 1
                    )
                    if self._trips_total
                    else 0.0,
                    "avg_fare_zar": avg_fare_zar,
                    "avg_duration_minutes": avg_duration_min,
                    "by_channel": dict(self._trips_by_channel),
                },
                "minute_series": counts,
                "live": live_block,
                "recent": {
                    "fraud": list(self._recent["fraud"])[-15:],
                    "safety": list(self._recent["safety"])[-15:],
                    "support": list(self._recent["support"])[-15:],
                    "trips": list(self._recent["trip"])[-15:],
                },
            }

    def recent(self, kind: str, limit: int = 20) -> list[dict[str, Any]]:
        if kind not in self._recent:
            return []
        buf = self._recent[kind]
        if limit >= len(buf):
            return list(buf)
        return list(buf)[-limit:]

    def reset(self) -> None:
        """Test helper: clear all counters and recent events."""
        self.__init__()

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #

    def _counts(self) -> dict[str, list[dict[str, Any]]]:
        # The minute_series payload has the last 60 minutes of per-minute
        # counters. This is enough resolution for an at-a-glance chart.
        now_minute = int(time.time() // 60)
        start = now_minute - 59
        keys = ("trip_lifecycle", "fraud_assessed", "support_handled")
        out: dict[str, list[dict[str, Any]]] = {k: [] for k in keys}
        # Drop expired buckets so the in-memory dict doesn't grow forever.
        # We don't store every bucket, only those that received hits — see _bump_minute.
        for minute_key in list(self._minute_buckets.keys()):
            ts = int(minute_key.split("|", 1)[0])
            if ts < start - 5:
                del self._minute_buckets[minute_key]
        for minute in range(start, now_minute + 1):
            for kind in keys:
                key = f"{minute}|{kind}"
                value = int(self._minute_buckets.get(key, 0))
                ts_iso = datetime.fromtimestamp(minute * 60, tz=timezone.utc).isoformat()
                out[kind].append({"minute": ts_iso, "count": value})
        return out

    def _bump_minute(self, kind: str) -> None:
        minute = int(time.time() // 60)
        if minute != self._minute_started:
            self._minute_started = minute
        key = f"{minute}|{kind}"
        self._minute_buckets[key] = int(self._minute_buckets.get(key, 0)) + 1

    def _fraud_reason_breakdown(self) -> dict[str, int]:
        out: Counter[str] = Counter()
        for ev in self._recent["fraud"]:
            for r in ev.get("reasons", []) or []:
                out[str(r)] += 1
        return dict(out)

    async def _live_block(self, db: Any) -> dict[str, Any]:
        from app.models import TripStatus

        ACTIVE = {
            TripStatus.requested,
            TripStatus.driver_assigned,
            TripStatus.driver_arriving,
            TripStatus.in_progress,
        }
        try:
            trips = await db.list_trips(limit=200)
        except Exception:
            trips = []
        try:
            drivers = await db.list_online_drivers()
        except Exception:
            drivers = []
        live_trips = [t for t in trips if t.status in ACTIVE]
        driver_points = [
            {
                "driver_id": d.id,
                "name": d.name,
                "is_online": bool(d.is_online),
                "lat": float(d.location.lat) if d.location else None,
                "lng": float(d.location.lng) if d.location else None,
                "vehicle": d.vehicle_make,
            }
            for d in drivers
            if d.location is not None
        ]
        live_points = [
            {
                "trip_id": t.id,
                "status": t.status.value,
                "rider_id": t.rider_id,
                "driver_id": t.driver_id,
                "lat": float(t.pickup.lat),
                "lng": float(t.pickup.lng),
                "fare_cents": int(t.fare_estimate_cents or 0),
            }
            for t in live_trips
        ]
        return {
            "live_rides": len(live_trips),
            "online_drivers": len(drivers),
            "drivers_with_location": len(driver_points),
            "driver_points": driver_points[:60],
            "live_trip_points": live_points[:60],
        }


_store: ObservabilityStore | None = None


def get_observability() -> ObservabilityStore:
    global _store
    if _store is None:
        _store = ObservabilityStore()
    return _store


def reset_observability() -> None:
    """Test helper."""
    global _store
    _store = None
