"""Apply database/init.sql idempotently when Postgres is connected."""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_SCHEMA_PATH = Path(__file__).resolve().parent.parent / "database" / "init.sql"


async def apply_schema(pool) -> bool:
    """Run init.sql against an asyncpg pool. Returns True if applied."""
    if pool is None:
        return False
    if not _SCHEMA_PATH.is_file():
        logger.warning("Schema file missing: %s", _SCHEMA_PATH)
        return False
    sql = _SCHEMA_PATH.read_text(encoding="utf-8")
    # Strip full-line SQL comments; keep statements separated by ;
    lines: list[str] = []
    for line in sql.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        lines.append(line)
    body = "\n".join(lines)
    statements = [s.strip() for s in body.split(";") if s.strip()]
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                for stmt in statements:
                    await conn.execute(stmt)
        logger.info("Postgres schema applied (%d statements from init.sql)", len(statements))
        return True
    except Exception as exc:
        logger.warning("Postgres schema apply failed: %s", exc)
        return False
