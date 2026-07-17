from __future__ import annotations

import pytest

from app.ai.fraud_detection import FraudDetection, FraudVerdict


@pytest.fixture
def fraud() -> FraudDetection:
    return FraudDetection()


@pytest.mark.asyncio
async def test_clean_trip_low_score(fraud: FraudDetection):
    verdict = await fraud.assess(
        {
            "requests_last_hour": 1,
            "gps_jump_km": 0.2,
            "payment_mismatch": False,
            "new_account_hours": 720,
            "fare_cents": 8500,
            "wallet_balance_cents": 10000,
        }
    )
    assert isinstance(verdict, FraudVerdict)
    assert verdict.score < 0.5
    assert verdict.should_hold is False


@pytest.mark.asyncio
async def test_high_anomaly_flags_hold(fraud: FraudDetection):
    verdict = await fraud.assess(
        {
            "requests_last_hour": 12,
            "gps_jump_km": 25.0,
            "payment_mismatch": True,
            "new_account_hours": 0.5,
            "fare_cents": 50000,
            "wallet_balance_cents": 0,
        }
    )
    assert verdict.score >= 0.8
    assert verdict.should_hold is True
    assert verdict.should_flag is True
    assert len(verdict.reasons) >= 2
