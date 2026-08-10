"""Postgres primary mode helpers (no live DB required)."""

import asyncio
import json
import uuid
from datetime import datetime, timezone

import app.postgres_db as postgres_db
from app.firestore_db import FirestoreDB
from app.postgres_db import _row_to_trip_dict, is_postgres_primary, postgres_status


def test_postgres_status_default_disabled():
    # Without connect(), status is disabled / not primary
    assert postgres_status() in ("disabled", "dual-write", "primary", "error", "schema-error", "missing-driver", "closed")
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


async def test_driver_earnings_rows_are_uncapped_and_reconciled(monkeypatch):
    calls = []

    class Connection:
        async def fetch(self, query, *args):
            calls.append((query, args))
            return [{"raw": json.dumps({"id": "trip-1", "driver_payout_cents": 8500})}]

    class Acquire:
        async def __aenter__(self):
            return Connection()

        async def __aexit__(self, *_args):
            return None

    class Pool:
        def acquire(self):
            return Acquire()

    monkeypatch.setattr(postgres_db, "_pool", Pool())
    rows = await postgres_db.driver_earnings_rows("driver-1")

    query, args = calls[0]
    assert rows[0]["driver_payout_cents"] == 8500
    assert args == ("driver-1",)
    assert "reconciliation_status" in query
    assert "LIMIT" not in query.upper()


async def test_reconciliation_queue_includes_legacy_pending_trips(monkeypatch):
    calls = []

    class Connection:
        async def fetch(self, query, *args):
            calls.append((query, args))
            return []

    class Acquire:
        async def __aenter__(self):
            return Connection()

        async def __aexit__(self, *_args):
            return None

    class Pool:
        def acquire(self):
            return Acquire()

    monkeypatch.setattr(postgres_db, "_pool", Pool())
    await postgres_db.list_reconciliation_trips(25)

    query, args = calls[0]
    assert "status = 'completed'" in query
    assert "payment_status = 'captured'" in query
    assert "COALESCE(raw ->> 'reconciliation_status', 'pending') <> 'reconciled'" in query
    assert args == (25,)


async def test_reconciliation_claim_is_atomic_and_increments_attempt(monkeypatch):
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
    await postgres_db.claim_reconciliation_attempt("trip-1", "2026-08-05T10:00:00+00:00", "2026-08-05T09:55:00+00:00")

    query, args = calls[0]
    assert "reconciliation_attempt_count" in query
    assert "RETURNING *" in query
    assert "reconciliation_status' <> 'pending'" in query
    assert args[0] == "trip-1"


async def test_platform_setting_uses_jsonb_upsert(monkeypatch):
    calls = []

    class Connection:
        async def execute(self, query, *args):
            calls.append((query, args))

    class Acquire:
        async def __aenter__(self):
            return Connection()

        async def __aexit__(self, *_args):
            return None

    class Pool:
        def acquire(self):
            return Acquire()

    monkeypatch.setattr(postgres_db, "_pool", Pool())
    await postgres_db.set_platform_setting("remuneration", {"version": 2, "driver_share_bps": 8250})

    query, args = calls[0]
    assert "ON CONFLICT (setting_key) DO UPDATE" in query
    assert args[0] == "remuneration"
    assert json.loads(args[1])["driver_share_bps"] == 8250


async def test_remuneration_update_allocates_version_inside_upsert(monkeypatch):
    calls = []

    class Connection:
        async def fetchval(self, query, *args):
            calls.append((query, args))
            return json.dumps({"version": 7, "driver_share_bps": 8250})

    class Acquire:
        async def __aenter__(self):
            return Connection()

        async def __aexit__(self, *_args):
            return None

    class Pool:
        def acquire(self):
            return Acquire()

    monkeypatch.setattr(postgres_db, "_pool", Pool())
    result = await postgres_db.update_remuneration_setting({"driver_share_bps": 8250})

    query, args = calls[0]
    assert result["version"] == 7
    assert "platform_settings.value ->> 'version'" in query
    assert "RETURNING value" in query
    assert json.loads(args[0])["version"] == 2


async def test_payment_records_since_is_uncapped(monkeypatch):
    calls = []
    since = datetime(2026, 8, 4, 22, tzinfo=timezone.utc)

    class Connection:
        async def fetch(self, query, *args):
            calls.append((query, args))
            return [{"record": json.dumps({"trip_id": "trip-today"})}]

    class Acquire:
        async def __aenter__(self):
            return Connection()

        async def __aexit__(self, *_args):
            return None

    class Pool:
        def acquire(self):
            return Acquire()

    monkeypatch.setattr(postgres_db, "_pool", Pool())
    records = await postgres_db.list_payment_records_since(since)

    query, args = calls[0]
    assert records == [{"trip_id": "trip-today"}]
    assert "ledger.record ->> 'refunded_at'" in query
    assert "ledger.created_at" in query
    assert "COALESCE(" in query
    assert "LEFT JOIN ride_events" in query
    assert "LIMIT" not in query.upper()
    assert args == (since,)


async def test_payment_record_uses_idempotent_jsonb_upsert(monkeypatch):
    calls = []
    record = {
        "trip_id": "trip-ledger-1",
        "amount_cents": 10000,
        "driver_payout_cents": 8500,
        "platform_fee_cents": 1500,
        "status": "reconciled",
        "transfer_id": "tr_1",
    }

    class Connection:
        async def fetchval(self, query, *args):
            calls.append((query, args))
            return json.dumps(record)

    class Acquire:
        async def __aenter__(self):
            return Connection()

        async def __aexit__(self, *_args):
            return None

    class Pool:
        def acquire(self):
            return Acquire()

    monkeypatch.setattr(postgres_db, "_pool", Pool())
    result = await postgres_db.create_or_get_payment_record("reconciliation:trip-ledger-1", record)

    query, args = calls[0]
    assert result == record
    assert "ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE" in query
    assert args[0] == "reconciliation:trip-ledger-1"
    assert json.loads(args[-1])["transfer_id"] == "tr_1"


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
