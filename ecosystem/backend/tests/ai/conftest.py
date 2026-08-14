from __future__ import annotations

import asyncio
import pytest
from fastapi.testclient import TestClient

from app.firestore_db import FirestoreDB, get_db, _memory
from app.main import app
from app.postgres_db import _pool, _primary, _status, is_postgres_primary, postgres_status
from app.seed import seed_demo_data


def _seed_memory():
    """Seed demo data into the module-level _memory dict via FirestoreDB."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        db = FirestoreDB()
        loop.run_until_complete(seed_demo_data(db))
    finally:
        loop.close()


@pytest.fixture(scope="session", autouse=True)
def _seed_demo_data():
    """Seed demo data once per session into the in-memory store.

    The in-memory store (_memory in firestore_db.py) is a module-level dict.
    Seeding at session scope ensures it's populated before any TestClient
    lifespan creates its own FirestoreDB instance. We also temporarily
    disable Postgres primary so list_trips_for_rider reads from memory.
    """
    # Disable Postgres primary for tests so the in-memory store is used
    _primary_old = _primary
    _status_old = _status
    _pool_old = _pool
    try:
        # Clear Postgres state so FirestoreDB falls back to in-memory
        import app.postgres_db as pgdb

        pgdb._primary = False
        pgdb._status = "disabled"
        pgdb._pool = None

        _seed_memory()
        yield
    finally:
        pgdb._primary = _primary_old
        pgdb._status = _status_old
        pgdb._pool = _pool_old


@pytest.fixture
def client_seed():
    """TestClient that sees pre-seeded demo data."""
    with TestClient(app) as c:
        yield c


@pytest.fixture
def client():
    """Plain TestClient (no seed) — most tests don't need demo data."""
    with TestClient(app) as c:
        yield c
