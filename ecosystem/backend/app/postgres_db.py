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

        await apply_schema(_pool)
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


async def mirror_payment(
    *,
    trip_id: str,
    amount_cents: int,
    kind: str,
    status: str,
    external_ref: str | None = None,
) -> None:
    if _pool is None:
        return
    try:
        async with _pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO payment_ledger (trip_external_id, amount_cents, kind, status, external_ref)
                VALUES ($1, $2, $3, $4, $5)
                """,
                trip_id,
                amount_cents,
                kind,
                status,
                external_ref,
            )
    except Exception as exc:
        logger.debug("Postgres payment mirror skipped: %s", exc)
