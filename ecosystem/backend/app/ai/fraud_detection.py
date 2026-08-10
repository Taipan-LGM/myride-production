"""Rule-based fraud scoring (pre-transaction / booking time)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class FraudVerdict:
    score: float
    should_flag: bool
    should_hold: bool
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class FraudDetection:
    """Pure rules engine — no sklearn dependency."""

    FLAG_THRESHOLD = 0.6
    HOLD_THRESHOLD = 0.8

    async def assess(self, signals: dict[str, Any]) -> FraudVerdict:
        score = 0.0
        reasons: list[str] = []

        requests = int(signals.get("requests_last_hour") or 0)
        if requests >= 8:
            score += 0.35
            reasons.append("rapid_requests")
        elif requests >= 4:
            score += 0.15
            reasons.append("elevated_request_rate")

        gps_jump = float(signals.get("gps_jump_km") or 0)
        if gps_jump >= 15:
            score += 0.3
            reasons.append("impossible_gps_jump")
        elif gps_jump >= 5:
            score += 0.1
            reasons.append("large_gps_jump")

        if signals.get("payment_mismatch"):
            score += 0.25
            reasons.append("payment_mismatch")

        new_hours = float(signals.get("new_account_hours") or 999)
        if new_hours < 2:
            score += 0.2
            reasons.append("brand_new_account")

        fare = float(signals.get("fare_cents") or 0)
        wallet = float(signals.get("wallet_balance_cents") or 0)
        if fare > 20000 and wallet <= 0:
            score += 0.15
            reasons.append("high_fare_zero_wallet")

        score = min(1.0, round(score, 3))
        return FraudVerdict(
            score=score,
            should_flag=score >= self.FLAG_THRESHOLD,
            should_hold=score >= self.HOLD_THRESHOLD,
            reasons=reasons,
        )
