from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

import app.extended_routes as extended_routes
from app.firestore_db import FirestoreDB
from app.main import app
from app.reconciliation import PaymentReconciliation


def _login(client: TestClient, email: str, password: str, role: str) -> str:
    res = client.post(
        "/auth/login",
        json={"identifier": email, "password": password, "role": role},
    )
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def test_payments_and_mutations_require_auth():
    with TestClient(app) as client:
        assert client.get("/payments/ledger").status_code == 401
        assert client.post(
            "/driver/update-availability",
            json={"driver_id": "driver-demo-001", "is_online": True},
        ).status_code == 401
        assert client.post(
            "/create-payment-intent",
            json={"amount_cents": 1000, "rider_id": "rider-demo-001"},
        ).status_code == 401

        rider = _login(client, "rider@myride.co.za", "ride123", "rider")
        driver = _login(client, "driver@myride.co.za", "drive123", "driver")
        admin = _login(client, "admin@myride.co.za", "admin123", "admin")

        # Rider cannot open ledger
        assert (
            client.get(
                "/payments/ledger",
                headers={"Authorization": f"Bearer {rider}"},
            ).status_code
            == 403
        )
        # Admin can
        assert (
            client.get(
                "/payments/ledger",
                headers={"Authorization": f"Bearer {admin}"},
            ).status_code
            == 200
        )
        assert client.get(
            "/admin/reconciliations",
            headers={"Authorization": f"Bearer {rider}"},
        ).status_code == 403
        queue = client.get(
            "/admin/reconciliations",
            headers={"Authorization": f"Bearer {admin}"},
        )
        assert queue.status_code == 200
        assert "items" in queue.json()

        # Driver availability self-only
        ok = client.post(
            "/driver/update-availability",
            headers={"Authorization": f"Bearer {driver}"},
            json={
                "driver_id": "driver-demo-001",
                "is_online": True,
                "location": {"lat": -33.92, "lng": 18.42},
            },
        )
        assert ok.status_code == 200, ok.text

        forbidden = client.post(
            "/driver/update-availability",
            headers={"Authorization": f"Bearer {driver}"},
            json={
                "driver_id": "someone-else",
                "is_online": True,
                "location": {"lat": -33.92, "lng": 18.42},
            },
        )
        assert forbidden.status_code == 403


def test_driver_cannot_complete_unassigned_trip():
    with TestClient(app) as client:
        rider = _login(client, "rider@myride.co.za", "ride123", "rider")
        driver = _login(client, "driver@myride.co.za", "drive123", "driver")
        admin = _login(client, "admin@myride.co.za", "admin123", "admin")

        requested = client.post(
            "/request-ride",
            headers={"Authorization": f"Bearer {rider}"},
            json={
                "rider_id": "rider-demo-001",
                "pickup": {"lat": -33.9249, "lng": 18.4241},
                "dropoff": {"lat": -33.9068, "lng": 18.4198},
                "fare_estimate_cents": 12000,
            },
        )
        assert requested.status_code == 200, requested.text

        completed = client.post(
            f"/complete-ride/{requested.json()['id']}",
            headers={"Authorization": f"Bearer {driver}"},
        )

        assert completed.status_code == 403
        assert completed.json()["detail"] == "Not assigned to this trip"

        accepted = client.post(
            f"/accept-ride/{requested.json()['id']}",
            headers={"Authorization": f"Bearer {driver}"},
            json={"driver_id": "driver-demo-001"},
        )
        assert accepted.status_code == 200, accepted.text

        accepted_again = client.post(
            f"/accept-ride/{requested.json()['id']}",
            headers={"Authorization": f"Bearer {driver}"},
            json={"driver_id": "driver-demo-001"},
        )
        assert accepted_again.status_code == 409
        assert accepted_again.json()["detail"] == "Trip is no longer available"

        completed = client.post(
            f"/complete-ride/{requested.json()['id']}",
            headers={"Authorization": f"Bearer {driver}"},
        )
        assert completed.status_code == 200, completed.text
        payload = completed.json()
        assert payload["receipt"]["driver_share_bps"] == 8500
        assert payload["receipt"]["driver_net_cents"] == 10200
        assert payload["reconciliation"]["driver_payout_cents"] == 10200
        assert payload["reconciliation"]["platform_fee_cents"] == 1800
        assert payload["trip"]["driver_payout_cents"] == 10200
        ledger = client.get("/payments/ledger", headers={"Authorization": f"Bearer {admin}"})
        assert ledger.status_code == 200
        matching = [item for item in ledger.json()["items"] if item["trip_id"] == requested.json()["id"]]
        assert len(matching) == 1

        repeated = client.post(
            f"/complete-ride/{requested.json()['id']}",
            headers={"Authorization": f"Bearer {driver}"},
        )
        assert repeated.status_code == 409
        assert repeated.json()["detail"] == "Trip is already completed"


def test_generic_status_route_cannot_bypass_completion_workflow():
    with TestClient(app) as client:
        admin = _login(client, "admin@myride.co.za", "admin123", "admin")
        response = client.post(
            "/trips/trip-demo-001/status/completed",
            headers={"Authorization": f"Bearer {admin}"},
        )

        assert response.status_code == 409
        assert "complete-ride workflow" in response.json()["detail"]


def test_partial_capture_and_direct_transfer_are_blocked():
    with TestClient(app) as client:
        rider = _login(client, "rider@myride.co.za", "ride123", "rider")
        driver = _login(client, "driver@myride.co.za", "drive123", "driver")
        admin = _login(client, "admin@myride.co.za", "admin123", "admin")
        requested = client.post(
            "/request-ride",
            headers={"Authorization": f"Bearer {rider}"},
            json={
                "rider_id": "rider-demo-001",
                "pickup": {"lat": -33.9249, "lng": 18.4241},
                "dropoff": {"lat": -33.9068, "lng": 18.4198},
                "fare_estimate_cents": 10000,
            },
        ).json()
        trip_id = requested["id"]
        client.post(
            f"/accept-ride/{trip_id}",
            headers={"Authorization": f"Bearer {driver}"},
            json={"driver_id": "driver-demo-001"},
        )
        hold = client.post(
            "/payments/hold",
            headers={"Authorization": f"Bearer {rider}"},
            json={"trip_id": trip_id, "amount_cents": 10000, "rider_id": "rider-demo-001", "currency": "zar"},
        )
        partial = client.post(
            "/payments/capture",
            headers={"Authorization": f"Bearer {driver}"},
            json={"trip_id": trip_id, "payment_intent_id": hold.json()["id"], "amount_cents": 1},
        )
        transfer = client.post(
            "/payments/transfer",
            headers={"Authorization": f"Bearer {admin}"},
            json={
                "trip_id": trip_id,
                "driver_stripe_account_id": "acct_test",
                "amount_cents": 8500,
            },
        )

        assert hold.status_code == 200
        assert partial.status_code == 409
        assert "must match the trip fare" in partial.json()["detail"]
        assert transfer.status_code == 410


def test_completed_trip_can_retry_failed_reconciliation(monkeypatch):
    real_reconciliation = PaymentReconciliation()

    class FlakyReconciliation:
        calls = 0

        async def reconcile_trip(self, *args, **kwargs):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("temporary payout outage")
            return await real_reconciliation.reconcile_trip(*args, **kwargs)

    flaky = FlakyReconciliation()
    monkeypatch.setattr(extended_routes, "get_reconciliation", lambda: flaky)

    with TestClient(app) as client:
        rider = _login(client, "rider@myride.co.za", "ride123", "rider")
        driver = _login(client, "driver@myride.co.za", "drive123", "driver")
        requested = client.post(
            "/request-ride",
            headers={"Authorization": f"Bearer {rider}"},
            json={
                "rider_id": "rider-demo-001",
                "pickup": {"lat": -33.9249, "lng": 18.4241},
                "dropoff": {"lat": -33.9068, "lng": 18.4198},
                "fare_estimate_cents": 10000,
            },
        )
        trip_id = requested.json()["id"]
        accepted = client.post(
            f"/accept-ride/{trip_id}",
            headers={"Authorization": f"Bearer {driver}"},
            json={"driver_id": "driver-demo-001"},
        )
        assert accepted.status_code == 200

        first = client.post(f"/complete-ride/{trip_id}", headers={"Authorization": f"Bearer {driver}"})
        retry = client.post(f"/complete-ride/{trip_id}", headers={"Authorization": f"Bearer {driver}"})
        repeated = client.post(f"/complete-ride/{trip_id}", headers={"Authorization": f"Bearer {driver}"})

        assert first.status_code == 503
        assert first.json()["detail"] == "Trip completed; payout reconciliation pending"
        assert retry.status_code == 200
        assert retry.json()["reconciliation"]["driver_payout_cents"] == 8500
        assert repeated.status_code == 409


def test_admin_versions_remuneration_policy_for_new_trips_only():
    with TestClient(app) as client:
        rider = _login(client, "rider@myride.co.za", "ride123", "rider")
        admin = _login(client, "admin@myride.co.za", "admin123", "admin")
        rider_headers = {"Authorization": f"Bearer {rider}"}
        admin_headers = {"Authorization": f"Bearer {admin}"}

        assert client.get("/admin/settings/remuneration", headers=rider_headers).status_code == 403
        before = client.get("/admin/settings/remuneration", headers=admin_headers).json()
        try:
            updated = client.patch(
                "/admin/settings/remuneration",
                headers=admin_headers,
                json={"driver_share_bps": 8250},
            )
            assert updated.status_code == 200, updated.text
            assert updated.json()["version"] == before["version"] + 1

            trip = client.post(
                "/request-ride",
                headers=rider_headers,
                json={
                    "rider_id": "rider-demo-001",
                    "pickup": {"lat": -33.9249, "lng": 18.4241},
                    "dropoff": {"lat": -33.9068, "lng": 18.4198},
                    "fare_estimate_cents": 10000,
                },
            )
            assert trip.status_code == 200, trip.text
            assert trip.json()["driver_share_bps"] == 8250
            assert trip.json()["remuneration_policy_version"] == updated.json()["version"]
        finally:
            client.patch(
                "/admin/settings/remuneration",
                headers=admin_headers,
                json={"driver_share_bps": 8500},
            )


@pytest.mark.asyncio
async def test_concurrent_remuneration_updates_allocate_distinct_versions():
    db = FirestoreDB()
    before = await db.get_remuneration_policy()

    first, second = await asyncio.gather(
        db.update_remuneration_policy(8100, "concurrent-one"),
        db.update_remuneration_policy(8200, "concurrent-two"),
    )

    assert sorted([first["version"], second["version"]]) == [before["version"] + 1, before["version"] + 2]
    assert (await db.get_remuneration_policy())["version"] == before["version"] + 2


def test_admin_reconciliation_rejects_pending_trip():
    with TestClient(app) as client:
        rider = _login(client, "rider@myride.co.za", "ride123", "rider")
        admin = _login(client, "admin@myride.co.za", "admin123", "admin")
        requested = client.post(
            "/request-ride",
            headers={"Authorization": f"Bearer {rider}"},
            json={
                "rider_id": "rider-demo-001",
                "pickup": {"lat": -33.9249, "lng": 18.4241},
                "dropoff": {"lat": -33.9068, "lng": 18.4198},
                "fare_estimate_cents": 10000,
            },
        )
        response = client.post(
            f"/payments/reconcile/{requested.json()['id']}",
            headers={"Authorization": f"Bearer {admin}"},
        )
        assert response.status_code == 409
        assert response.json()["detail"] == "Trip must be completed before reconciliation"


def test_live_completion_requires_authorized_payment(monkeypatch):
    class LiveStripe:
        enabled = True

        async def capture(self, *_args):
            raise AssertionError("capture must not run without a payment intent")

    monkeypatch.setattr(extended_routes, "get_stripe", lambda: LiveStripe())

    with TestClient(app) as client:
        rider = _login(client, "rider@myride.co.za", "ride123", "rider")
        driver = _login(client, "driver@myride.co.za", "drive123", "driver")
        requested = client.post(
            "/request-ride",
            headers={"Authorization": f"Bearer {rider}"},
            json={
                "rider_id": "rider-demo-001",
                "pickup": {"lat": -33.9249, "lng": 18.4241},
                "dropoff": {"lat": -33.9068, "lng": 18.4198},
                "fare_estimate_cents": 10000,
            },
        )
        trip_id = requested.json()["id"]
        client.post(
            f"/accept-ride/{trip_id}",
            headers={"Authorization": f"Bearer {driver}"},
            json={"driver_id": "driver-demo-001"},
        )

        completed = client.post(f"/complete-ride/{trip_id}", headers={"Authorization": f"Bearer {driver}"})

        assert completed.status_code == 409
        assert completed.json()["detail"] == "Trip payment is not authorized"
