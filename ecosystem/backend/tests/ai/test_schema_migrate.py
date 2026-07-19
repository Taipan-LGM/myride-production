"""Schema migrate parses init.sql into executable statements."""

from __future__ import annotations

from pathlib import Path

from app.schema_migrate import _SCHEMA_PATH, apply_schema


def test_schema_file_exists():
    assert _SCHEMA_PATH.is_file()
    text = _SCHEMA_PATH.read_text(encoding="utf-8")
    assert "ride_events" in text
    assert "CREATE TABLE" in text


def test_apply_schema_noop_without_pool():
    import asyncio

    assert asyncio.run(apply_schema(None)) is False
