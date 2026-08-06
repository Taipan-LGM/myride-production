"""Schema migrate parses init.sql into executable statements."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.schema_migrate import _SCHEMA_PATH, apply_schema


def test_schema_file_exists():
    assert _SCHEMA_PATH.is_file()
    text = _SCHEMA_PATH.read_text(encoding="utf-8")
    assert "ride_events" in text
    assert "CREATE TABLE" in text


def test_apply_schema_noop_without_pool():
    import asyncio

    assert asyncio.run(apply_schema(None)) is False


class _Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None


class _Connection:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def transaction(self):
        return _Transaction()

    async def execute(self, statement: str):
        self.statements.append(statement)


class _Acquire:
    def __init__(self, connection: _Connection) -> None:
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return None


class _Pool:
    def __init__(self) -> None:
        self.connection = _Connection()

    def acquire(self):
        return _Acquire(self.connection)


@pytest.mark.asyncio
async def test_schema_applies_bounded_phase0_cleanup_in_dependency_order():
    pool = _Pool()

    assert await apply_schema(pool) is True

    cleanup = [statement for statement in pool.connection.statements if statement.startswith("DELETE FROM")]
    assert cleanup[0].startswith("DELETE FROM payment_ledger")
    assert cleanup[1] == "DELETE FROM ride_events WHERE raw ->> 'booking_channel' = 'phase0'"
    assert cleanup[2] == "DELETE FROM rides WHERE booking_channel = 'phase0'"
    assert cleanup[3] == "DELETE FROM driver_locations WHERE driver_external_id LIKE 'driver-phase0-%'"
    assert all("phase0" in statement for statement in cleanup)
