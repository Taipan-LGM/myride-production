from __future__ import annotations

"""Tests for the /ops/* AI observability surface (Part 10 of the brief).

Covers both the in-process counter store and the HTTP/WebSocket endpoints:
- recording fraud / safety / support / trip events updates counters correctly
- /ops/observability requires admin auth and returns the snapshot payload
- admin-only dry-run evaluators push real events into the store
- /ops/observability/recent filters by kind
- /ws/ops streams live snapshots to subscribers
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.ai.customer_service import IssueCategory, ResolutionAction
from app.ai.fraud_detection import FraudDetection
from app.ai.safety_monitor import SafetyAlert, SafetyAlertType, SafetyMonitor
from app.main import app
from app.observability import (
    ObservabilityStore,
    get_observability,
    reset_observability,
)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _admin_token(client: TestClient) -> str:
    res = client.post(
        "/auth/login",
        json={
            "identifier": "admin@myride.co.za",
            "password": "admin123",
            "role": "admin",
        },
    )
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _rider_token(client: TestClient) -> str:
    res = client.post(
        "/auth/login",
        json={
            "identifier": "rider@myride.co.za",
            "password": "ride123",
            "role": "rider",
        },
    )
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


# --------------------------------------------------------------------------- #
# Unit tests — the counter store
# --------------------------------------------------------------------------- #
def test_store_records_fraud_and_reasons():
    reset_observability()
    store = ObservabilityStore()
    fraud = FraudDetection()
    v1 = asyncio.run(
        fraud.assess(
            {
                "requests_last_hour": 12,
                "gps_jump_km": 25.0,
                "payment_mismatch": True,
                "new_account_hours": 0.5,
                "fare_cents": 50000,
                "wallet_balance_cents": 0,
            }
        )
    )
    store.record_fraud(v1)
    snap = asyncio.run(store.snapshot(None))
    assert snap["fraud"]["total_assessments"] == 1
    assert snap["fraud"]["held"] == 1
    assert snap["fraud"]["avg_score"] >= 0.8
    assert "rapid_requests" in snap["fraud"]["by_reason"]
    assert snap["recent"]["fraud"][-1]["held"] is True


def test_store_records_safety_alerts_by_type_and_severity():
    reset_observability()
    store = ObservabilityStore()
    alerts = [
        SafetyAlert(
            alert_type=SafetyAlertType.ROUTE_DEVIATION,
            trip_id="t1",
            message="deviation",
            severity="high",
        ),
        SafetyAlert(
            alert_type=SafetyAlertType.UNUSUAL_SPEED,
            trip_id="t1",
            message="fast",
            severity="high",
        ),
    ]
    store.record_safety(alerts)
    snap = asyncio.run(store.snapshot(None))
    assert snap["safety"]["total_alerts"] == 2
    assert snap["safety"]["by_type"]["route_deviation"] == 1
    assert snap["safety"]["by_type"]["unusual_speed"] == 1
    assert snap["safety"]["by_severity"]["high"] == 2


def test_store_records_support_and_ai_resolution_rate():
    reset_observability()
    store = ObservabilityStore()
    # 4 resolved (no escalation) + 1 escalated
    for _ in range(4):
        store.record_support(
            IssueCategory.REFUND,
            ResolutionAction.PROCESS_REFUND,
            confidence=0.9,
            escalated=False,
        )
    store.record_support(
        IssueCategory.SAFETY,
        ResolutionAction.ESCALATE_HUMAN,
        confidence=0.2,
        escalated=True,
    )
    snap = asyncio.run(store.snapshot(None))
    assert snap["support"]["total"] == 5
    assert snap["support"]["resolved"] == 4
    assert snap["support"]["escalated"] == 1
    # 4 / 5 * 100 = 80.0%; below the 90 alert threshold
    assert snap["ai_resolution_rate"] == 80.0
    assert snap["ai_resolution_alert"] is True


def test_store_records_trip_completion_with_fare_and_duration():
    reset_observability()
    store = ObservabilityStore()
    store.record_completion(duration_seconds=600.0, fare_cents=8500, channel="app")
    snap = asyncio.run(store.snapshot(None))
    assert snap["trips"]["completed"] == 1
    assert snap["trips"]["by_channel"]["app"] == 1
    assert snap["trips"]["avg_fare_zar"] == 85.0
    assert snap["trips"]["avg_duration_minutes"] == 10.0
    assert snap["trips"]["completion_rate"] == 100.0


def test_store_recent_filters_by_kind():
    reset_observability()
    store = ObservabilityStore()
    store.record_support(
        IssueCategory.ACCOUNT,
        ResolutionAction.SEND_MESSAGE,
        0.8,
        escalated=False,
    )
    # support event should not leak into the fraud feed
    assert store.recent("fraud", limit=5) == []
    assert len(store.recent("support", limit=5)) == 1
    # unknown kind returns empty
    assert store.recent("bogus", limit=5) == []


# --------------------------------------------------------------------------- #
# Integration tests — HTTP endpoints on the real app
# --------------------------------------------------------------------------- #
def test_observability_requires_admin():
    reset_observability()
    with TestClient(app) as client:
        # No token
        noauth = client.get("/ops/observability")
        assert noauth.status_code in (401, 403)
        # Rider token (non-admin)
        token = _rider_token(client)
        rider = client.get(
            "/ops/observability",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert rider.status_code in (401, 403)


def test_observability_snapshot_payload_shape():
    reset_observability()
    with TestClient(app) as client:
        token = _admin_token(client)
        res = client.get(
            "/ops/observability",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        for key in (
            "ai_resolution_rate",
            "ai_resolution_target",
            "ai_resolution_alert",
            "fraud",
            "safety",
            "support",
            "trips",
            "minute_series",
            "live",
            "recent",
        ):
            assert key in data
        assert data["ai_resolution_target"] == 95.0
        # live block comes from the DB (in-memory demo store)
        assert "live_rides" in data["live"]
        assert "online_drivers" in data["live"]


def test_admin_safety_dryrun_increments_counters():
    reset_observability()
    with TestClient(app) as client:
        token = _admin_token(client)
        headers = {"Authorization": f"Bearer {token}"}
        before = client.get("/ops/observability", headers=headers).json()
        assert before["safety"]["total_alerts"] == 0

        dry = client.post(
            "/ops/observability/safety/test",
            headers=headers,
            json={"trip_id": "t-dry", "route_deviation": 0.7, "speed_kmh": 140},
        )
        assert dry.status_code == 200, dry.text
        body = dry.json()
        assert len(body["alerts"]) >= 1
        assert any(a["alert_type"] == "route_deviation" for a in body["alerts"])

        after = client.get("/ops/observability", headers=headers).json()
        assert after["safety"]["total_alerts"] == body["count"]
        assert after["safety"]["by_type"]["route_deviation"] >= 1
        # feed should contain the new safety event
        assert any(
            e["trip_id"] == "t-dry" for e in after["recent"]["safety"]
        )


def test_admin_fraud_dryrun_increments_counters():
    reset_observability()
    with TestClient(app) as client:
        token = _admin_token(client)
        headers = {"Authorization": f"Bearer {token}"}
        dry = client.post(
            "/ops/observability/fraud/test",
            headers=headers,
            json={
                "requests_last_hour": 12,
                "gps_jump_km": 25.0,
                "payment_mismatch": True,
                "new_account_hours": 0.5,
                "fare_cents": 50000,
                "wallet_balance_cents": 0,
            },
        )
        assert dry.status_code == 200, dry.text
        body = dry.json()
        assert body["score"] >= 0.8
        after = client.get("/ops/observability", headers=headers).json()
        assert after["fraud"]["total_assessments"] == 1
        assert after["fraud"]["held"] == 1


def test_recent_endpoint_filters_by_kind():
    reset_observability()
    with TestClient(app) as client:
        token = _admin_token(client)
        headers = {"Authorization": f"Bearer {token}"}
        # generate a fraud event via dry-run
        client.post(
            "/ops/observability/fraud/test",
            headers=headers,
            json={
                "requests_last_hour": 12,
                "gps_jump_km": 25.0,
                "payment_mismatch": True,
                "new_account_hours": 0.5,
                "fare_cents": 50000,
                "wallet_balance_cents": 0,
            },
        )
        only_fraud = client.get(
            "/ops/observability/recent?kind=fraud&limit=5", headers=headers
        )
        assert only_fraud.status_code == 200, only_fraud.text
        assert len(only_fraud.json()["fraud"]) == 1
        assert only_fraud.json()["fraud"][0]["kind"] == "fraud"

        # rider cannot access the recent feed
        rider_token = _rider_token(client)
        denied = client.get(
            "/ops/observability/recent?kind=fraud",
            headers={"Authorization": f"Bearer {rider_token}"},
        )
        assert denied.status_code in (401, 403)


# --------------------------------------------------------------------------- #
# Integration test — /ws/ops live stream
# --------------------------------------------------------------------------- #
def test_ws_ops_streams_snapshots():
    reset_observability()
    with TestClient(app) as client:
        token = _admin_token(client)
        with client.websocket_connect("/ws/ops") as ws:
            # Auth handshake (mirrors the dashboard client).
            ws.send_json({"type": "auth", "token": token})
            # The endpoint sends an initial snapshot immediately on connect.
            msg = ws.receive_json()
            assert msg.get("type") == "ops.snapshot"
            for key in ("ai_resolution_rate", "fraud", "safety", "live"):
                assert key in msg
