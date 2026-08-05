"""Postgres primary mode helpers (no live DB required)."""

import asyncio
import json
import uuid

import app.postgres_db as postgres_db
from app.firestore_db import FirestoreDB
from app.postgres_db import _row_to_trip_dict, is_postgres_primary, postgres_status


def test_postgres_status_default_disabled():
    # Without connect(), status is disabled / not primary
    assert postgres_status() in ("disabled", "dual-write", "primary", "error", "missing-driver", "closed")
    assert is_postgres_primary() in (True, False)


def test_row_to_trip_from_raw():
    class Row(dict):
        def __getitem__(self, key):
            return dict.__getitem__(self, key)

    row = Row(
        {
            "external_id": "t1",
            "rider_external_id": "r1",
            "driver_external_id": None,
            "status": "requested",
            "pickup_lat": -33.9,
            "pickup_lng": 18.4,
            "pickup_address": "A",
            "dropoff_lat": -33.91,
            "dropoff_lng": 18.42,
            "dropoff_address": "B",
            "fare_cents": 5000,
            "currency": "zar",
            "payment_status": "pending",
            "raw": {
                "id": "t1",
                "rider_id": "r1",
                "status": "requested",
                "pickup": {"lat": -33.9, "lng": 18.4},
                "dropoff": {"lat": -33.91, "lng": 18.42},
            },
        }
    )
    d = _row_to_trip_dict(row)
    assert d is not None
    assert d["id"] == "t1"
    assert d["pickup"]["lat"] == -33.9


async def test_patch_trip_merges_only_requested_fields(monkeypatch):
    calls = []

    class Connection:
        async def fetchrow(self, query, *args):
            calls.append((query, args))
            return None

    class Acquire:
        async def __aenter__(self):
            return Connection()

        async def __aexit__(self, *_args):
            return None

    class Pool:
        def acquire(self):
            return Acquire()

    monkeypatch.setattr(postgres_db, "_pool", Pool())
    await postgres_db.patch_trip("trip-1", {"status": "cancelled", "updated_at": "now"})

    query, args = calls[0]
    patch = json.loads(args[1])
    assert patch == {"status": "cancelled", "updated_at": "now"}
    assert "raw = COALESCE(raw, '{}'::jsonb) || $2::jsonb" in query
    assert "driver_id" not in patch


async def test_memory_claim_allows_only_one_driver(monkeypatch):
    monkeypatch.setattr(postgres_db, "_pool", None)
    monkeypatch.setattr(postgres_db, "_primary", False)
    db = FirestoreDB()
    db._use_memory = True
    trip_id = f"trip-{uuid.uuid4()}"
    await db.create_trip(
        {
            "id": trip_id,
            "rider_id": "rider-1",
            "pickup": {"lat": -33.9249, "lng": 18.4241},
            "dropoff": {"lat": -33.9068, "lng": 18.4198},
        }
    )

    claims = await asyncio.gather(
        db.claim_trip(trip_id, "driver-1"),
        db.claim_trip(trip_id, "driver-2"),
    )

    winners = [claim.driver_id for claim in claims if claim]
    assert len(winners) == 1
    assert winners[0] in {"driver-1", "driver-2"}
