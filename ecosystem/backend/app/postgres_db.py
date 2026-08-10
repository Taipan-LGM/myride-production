"""Postgres dual-write + optional primary store (schema: database/init.sql).

- Default: Firestore/in-memory primary; when DATABASE_URL is set, trips are mirrored.
- Part 11: USE_POSTGRES_PRIMARY=true → ride_events is source of truth for trips.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

_pool = None
_status = "disabled"
_primary = False


def _json_object(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return None
        return decoded if isinstance(decoded, dict) else None
    return None


def postgres_status() -> str:
    if _status == "connected" and _primary:
        return "primary"
    if _status == "connected":
        return "dual-write"
    return _status


def is_postgres_primary() -> bool:
    return bool(_primary and _pool is not None)


async def connect_postgres(settings: Settings | None = None) -> None:
    global _pool, _status, _primary
    settings = settings or get_settings()
    url = (settings.database_url or "").strip()
    _primary = bool(settings.use_postgres_primary)
    if not url:
        _status = "disabled"
        if _primary:
            logger.warning("USE_POSTGRES_PRIMARY set but DATABASE_URL empty — falling back")
            _primary = False
        return
    try:
        import asyncpg
    except ImportError:
        logger.warning("asyncpg not installed — Postgres disabled")
        _status = "missing-driver"
        _primary = False
        return
    try:
        _pool = await asyncpg.create_pool(dsn=url, min_size=1, max_size=4, command_timeout=5)
        async with _pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        _status = "connected"
        mode = "PRIMARY" if _primary else "dual-write"
        logger.info("Postgres connected (%s)", mode)
        from app.schema_migrate import apply_schema

        if not await apply_schema(_pool):
            await _pool.close()
            _pool = None
            _status = "schema-error"
            _primary = False
            logger.error("Postgres disabled because required schema migration failed")
    except Exception as exc:
        _pool = None
        _status = "error"
        _primary = False
        logger.warning("Postgres unavailable (%s) — continuing with memory/Firestore", exc)


async def close_postgres() -> None:
    global _pool, _status
    if _pool is not None:
        await _pool.close()
        _pool = None
    if _status == "connected":
        _status = "closed"


def _geo(payload: dict[str, Any], key: str) -> tuple[float | None, float | None]:
    point = payload.get(key) or {}
    if isinstance(point, dict):
        return point.get("lat"), point.get("lng")
    lat = getattr(point, "lat", None)
    lng = getattr(point, "lng", None)
    return lat, lng


async def mirror_trip(payload: dict[str, Any]) -> None:
    """Insert/upsert trip into ride_events (dual-write or primary)."""
    if _pool is None:
        return
    pickup_lat, pickup_lng = _geo(payload, "pickup")
    dropoff_lat, dropoff_lng = _geo(payload, "dropoff")
    trip_id = str(payload.get("id") or "")
    if not trip_id:
        return
    fare = payload.get("fare_final_cents") or payload.get("fare_estimate_cents")
    try:
        async with _pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO ride_events (
                    external_id, rider_external_id, driver_external_id, status,
                    pickup_lat, pickup_lng, pickup_address,
                    dropoff_lat, dropoff_lng, dropoff_address,
                    fare_cents, currency, payment_status, raw
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7,
                    $8, $9, $10,
                    $11, $12, $13, $14::jsonb
                )
                ON CONFLICT (external_id) DO UPDATE SET
                    driver_external_id = EXCLUDED.driver_external_id,
                    status = EXCLUDED.status,
                    fare_cents = COALESCE(EXCLUDED.fare_cents, ride_events.fare_cents),
                    payment_status = EXCLUDED.payment_status,
                    raw = EXCLUDED.raw,
                    updated_at = NOW()
                """,
                trip_id,
                payload.get("rider_id"),
                payload.get("driver_id"),
                str(payload.get("status") or "requested"),
                pickup_lat,
                pickup_lng,
                payload.get("pickup_address"),
                dropoff_lat,
                dropoff_lng,
                payload.get("dropoff_address"),
                int(fare) if fare is not None else None,
                str(payload.get("currency") or "zar"),
                str(payload.get("payment_status") or "pending"),
                json.dumps(payload, default=str),
            )
    except Exception as exc:
        if _primary:
            logger.exception("Postgres primary write failed: %s", exc)
            raise
        logger.debug("Postgres mirror skipped: %s", exc)


def _row_to_trip_dict(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None
    raw = row["raw"]
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = {}
    if isinstance(raw, dict) and raw.get("id"):
        return dict(raw)
    # Reconstruct from columns when raw missing
    return {
        "id": row["external_id"],
        "rider_id": row["rider_external_id"],
        "driver_id": row["driver_external_id"],
        "status": row["status"],
        "pickup": {"lat": row["pickup_lat"], "lng": row["pickup_lng"]},
        "dropoff": {"lat": row["dropoff_lat"], "lng": row["dropoff_lng"]},
        "pickup_address": row["pickup_address"],
        "dropoff_address": row["dropoff_address"],
        "fare_estimate_cents": row["fare_cents"],
        "currency": row["currency"] or "zar",
        "payment_status": row["payment_status"],
    }


async def fetch_trip(trip_id: str) -> dict[str, Any] | None:
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM ride_events WHERE external_id = $1",
            trip_id,
        )
    return _row_to_trip_dict(row)


async def claim_trip(trip_id: str, driver_id: str) -> dict[str, Any] | None:
    """Atomically assign a requested, unassigned trip to one driver."""
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE ride_events
            SET driver_external_id = $2,
                status = 'driver_assigned',
                raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object(
                    'driver_id', $2,
                    'status', 'driver_assigned',
                    'updated_at', NOW()
                ),
                updated_at = NOW()
            WHERE external_id = $1
              AND driver_external_id IS NULL
              AND status = 'requested'
            RETURNING *
            """,
            trip_id,
            driver_id,
        )
    return _row_to_trip_dict(row)


async def patch_trip(trip_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
    """Atomically merge selected trip fields without overwriting concurrent changes."""
    if _pool is None:
        return None
    payload = json.dumps(updates, default=str)
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE ride_events
            SET driver_external_id = CASE
                    WHEN $2::jsonb ? 'driver_id' THEN $2::jsonb ->> 'driver_id'
                    ELSE driver_external_id
                END,
                status = COALESCE($2::jsonb ->> 'status', status),
                fare_cents = CASE
                    WHEN $2::jsonb ? 'fare_final_cents'
                        THEN ($2::jsonb ->> 'fare_final_cents')::integer
                    ELSE fare_cents
                END,
                payment_status = COALESCE($2::jsonb ->> 'payment_status', payment_status),
                raw = COALESCE(raw, '{}'::jsonb) || $2::jsonb,
                updated_at = NOW()
            WHERE external_id = $1
            RETURNING *
            """,
            trip_id,
            payload,
        )
    return _row_to_trip_dict(row)


async def list_trips(
    *,
    rider_id: str | None = None,
    driver_id: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    if _pool is None:
        return []
    clauses: list[str] = []
    args: list[Any] = []
    if rider_id:
        args.append(rider_id)
        clauses.append(f"rider_external_id = ${len(args)}")
    if driver_id:
        args.append(driver_id)
        clauses.append(f"driver_external_id = ${len(args)}")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    args.append(limit)
    sql = f"""
        SELECT * FROM ride_events
        {where}
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT ${len(args)}
    """
    async with _pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)
    out: list[dict[str, Any]] = []
    for row in rows:
        d = _row_to_trip_dict(row)
        if d:
            out.append(d)
    return out


async def list_reconciliation_trips(limit: int = 50) -> list[dict[str, Any]]:
    if _pool is None:
        return []
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM ride_events
            WHERE status = 'completed'
              AND payment_status = 'captured'
              AND COALESCE(raw ->> 'reconciliation_status', 'pending') <> 'reconciled'
            ORDER BY COALESCE(
                (raw ->> 'reconciliation_attempted_at')::timestamptz,
                updated_at,
                created_at
            ) DESC
            LIMIT $1
            """,
            limit,
        )
    return [item for row in rows if (item := _row_to_trip_dict(row)) is not None]


async def claim_reconciliation_attempt(
    trip_id: str,
    attempted_at: str,
    stale_before: str,
) -> dict[str, Any] | None:
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE ride_events
            SET raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object(
                    'reconciliation_status', 'pending',
                    'reconciliation_attempt_count', COALESCE((raw ->> 'reconciliation_attempt_count')::integer, 0) + 1,
                    'reconciliation_attempted_at', $2::text,
                    'reconciliation_error', NULL,
                    'updated_at', $2::text
                ),
                updated_at = NOW()
            WHERE external_id = $1
              AND status = 'completed'
              AND payment_status = 'captured'
              AND COALESCE(raw ->> 'reconciliation_status', 'pending') <> 'reconciled'
              AND (
                  raw ->> 'reconciliation_status' <> 'pending'
                  OR raw ->> 'reconciliation_attempted_at' IS NULL
                  OR (raw ->> 'reconciliation_attempted_at')::timestamptz < $3::timestamptz
              )
            RETURNING *
            """,
            trip_id,
            attempted_at,
            stale_before,
        )
    return _row_to_trip_dict(row)


async def claim_refund_attempt(trip_id: str, attempted_at: str, stale_before: str) -> dict[str, Any] | None:
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE ride_events
            SET raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object(
                    'refund_status', 'pending',
                    'refund_attempt_count', COALESCE((raw ->> 'refund_attempt_count')::integer, 0) + 1,
                    'refund_attempted_at', $2::text,
                    'refund_error', NULL,
                    'updated_at', $2::text
                ),
                updated_at = NOW()
            WHERE external_id = $1
              AND payment_status IN ('captured', 'refunded')
              AND COALESCE(raw ->> 'refund_status', 'none') <> 'refunded'
              AND (
                  raw ->> 'refund_status' <> 'pending'
                  OR raw ->> 'refund_attempted_at' IS NULL
                  OR (raw ->> 'refund_attempted_at')::timestamptz < $3::timestamptz
              )
            RETURNING *
            """,
            trip_id,
            attempted_at,
            stale_before,
        )
    return _row_to_trip_dict(row)


async def driver_earnings_rows(driver_id: str) -> list[dict[str, Any]]:
    """Return uncapped persisted payout snapshots for one driver."""
    if _pool is None:
        return []
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT raw
            FROM ride_events
            WHERE driver_external_id = $1
              AND status = 'completed'
              AND raw ->> 'reconciliation_status' = 'reconciled'
            ORDER BY updated_at DESC NULLS LAST, created_at DESC
            """,
            driver_id,
        )
    return [decoded for row in rows if (decoded := _json_object(row["raw"])) is not None]


async def get_platform_setting(setting_key: str) -> dict[str, Any] | None:
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        value = await conn.fetchval(
            "SELECT value FROM platform_settings WHERE setting_key = $1",
            setting_key,
        )
    return _json_object(value)


async def set_platform_setting(setting_key: str, value: dict[str, Any]) -> None:
    if _pool is None:
        return
    payload = json.dumps(value, default=str)
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO platform_settings (setting_key, value, updated_at)
            VALUES ($1, $2::jsonb, NOW())
            ON CONFLICT (setting_key) DO UPDATE
            SET value = EXCLUDED.value, updated_at = NOW()
            """,
            setting_key,
            payload,
        )


async def update_remuneration_setting(fields: dict[str, Any]) -> dict[str, Any]:
    """Atomically allocate the next remuneration policy version."""
    policy = {"version": 2, **fields}
    if _pool is None:
        return policy
    payload = json.dumps(policy, default=str)
    async with _pool.acquire() as conn:
        value = await conn.fetchval(
            """
            INSERT INTO platform_settings (setting_key, value, updated_at)
            VALUES ('remuneration', $1::jsonb, NOW())
            ON CONFLICT (setting_key) DO UPDATE
            SET value = EXCLUDED.value || jsonb_build_object(
                    'version', COALESCE((platform_settings.value ->> 'version')::integer, 1) + 1
                ),
                updated_at = NOW()
            RETURNING value
            """,
            payload,
        )
    return _json_object(value) or policy


async def get_payment_record(idempotency_key: str) -> dict[str, Any] | None:
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        value = await conn.fetchval(
            "SELECT record FROM payment_ledger WHERE idempotency_key = $1",
            idempotency_key,
        )
    return _json_object(value)


async def create_or_get_payment_record(
    idempotency_key: str,
    record: dict[str, Any],
    kind: str = "reconciliation",
) -> dict[str, Any]:
    if _pool is None:
        return record
    payload = json.dumps(record, default=str)
    async with _pool.acquire() as conn:
        value = await conn.fetchval(
            """
            INSERT INTO payment_ledger (
                idempotency_key, trip_external_id, amount_cents, kind, status, external_ref, record
            ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE
            SET idempotency_key = payment_ledger.idempotency_key
            RETURNING record
            """,
            idempotency_key,
            record["trip_id"],
            record["amount_cents"],
            kind,
            record["status"],
            record.get("refund_id") or record.get("transfer_id"),
            payload,
        )
    return _json_object(value) or record


async def list_payment_records(limit: int = 50) -> list[dict[str, Any]]:
    if _pool is None:
        return []
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT record FROM payment_ledger
            WHERE record IS NOT NULL
            ORDER BY created_at DESC
            LIMIT $1
            """,
            limit,
        )
    return [decoded for row in rows if (decoded := _json_object(row["record"])) is not None]


async def list_payment_records_since(since: datetime) -> list[dict[str, Any]]:
    if _pool is None:
        return []
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT COALESCE(
                ledger.record,
                jsonb_build_object(
                    'trip_id', ledger.trip_external_id,
                    'amount_cents', ledger.amount_cents,
                    'driver_payout_cents', COALESCE((event.raw ->> 'driver_payout_cents')::integer, 0),
                    'platform_fee_cents', COALESCE((event.raw ->> 'platform_fee_cents')::integer, 0),
                    'status', ledger.status,
                    'reconciled_at', ledger.created_at
                )
            ) AS record
            FROM payment_ledger AS ledger
            LEFT JOIN ride_events AS event ON event.external_id = ledger.trip_external_id
            WHERE COALESCE(
                NULLIF(ledger.record ->> 'reconciled_at', '')::timestamptz,
                NULLIF(ledger.record ->> 'refunded_at', '')::timestamptz,
                ledger.created_at
            ) >= $1
            ORDER BY ledger.created_at DESC
            """,
            since,
        )
    return [decoded for row in rows if (decoded := _json_object(row["record"])) is not None]
