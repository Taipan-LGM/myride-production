from __future__ import annotations

import json
import logging
from typing import Any

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


class RedisCache:
    """Optional Redis cache for driver locations and trip snapshots."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._client = None
        self._enabled = False

    async def connect(self) -> None:
        try:
            import redis.asyncio as redis

            self._client = redis.from_url(
                self.settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
            await self._client.ping()
            self._enabled = True
            logger.info("Redis connected: %s", self.settings.redis_url)
        except Exception as exc:
            self._client = None
            self._enabled = False
            logger.warning("Redis unavailable (%s) — continuing without cache", exc)

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None
            self._enabled = False

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def set_json(self, key: str, value: Any, ttl_seconds: int = 300) -> None:
        if not self._enabled or self._client is None:
            return
        await self._client.setex(key, ttl_seconds, json.dumps(value))

    async def get_json(self, key: str) -> Any | None:
        if not self._enabled or self._client is None:
            return None
        raw = await self._client.get(key)
        return json.loads(raw) if raw else None

    async def delete(self, key: str) -> None:
        if not self._enabled or self._client is None:
            return
        await self._client.delete(key)


_cache: RedisCache | None = None


async def get_cache() -> RedisCache:
    global _cache
    if _cache is None:
        _cache = RedisCache()
        await _cache.connect()
    return _cache
