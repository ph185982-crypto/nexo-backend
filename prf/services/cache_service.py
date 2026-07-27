"""
PRF Cache Service — Redis with graceful in-memory fallback.
Mirrors the pattern from database/db.py but scoped to PRF.
"""
from __future__ import annotations
import json
import time
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

_redis = None
_mem_cache: dict[str, tuple] = {}


async def _get_redis(redis_url: str):
    global _redis
    if _redis is not None:
        return _redis
    if not redis_url:
        return None
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(redis_url, decode_responses=True, socket_connect_timeout=3)
        await r.ping()
        _redis = r
        logger.info("[PRF] Redis connected")
    except Exception as e:
        logger.warning(f"[PRF] Redis unavailable ({e}) — using memory cache")
    return _redis


class PRFCacheService:
    DEFAULT_TTL = 3600

    TTL_SUBJECTS = 86400      # 24h — rarely changes
    TTL_LEGAL_DOCS = 86400    # 24h
    TTL_LEGAL_ARTICLES = 43200  # 12h
    TTL_QUESTIONS = 3600      # 1h
    TTL_DASHBOARD = 300       # 5min
    TTL_SESSION = 7200        # 2h

    def __init__(self, redis_url: str = ""):
        self._redis_url = redis_url

    async def _r(self):
        return await _get_redis(self._redis_url)

    async def get(self, key: str) -> Any | None:
        full_key = f"prf:{key}"
        try:
            r = await self._r()
            if r:
                v = await r.get(full_key)
                return json.loads(v) if v else None
        except Exception:
            pass
        entry = _mem_cache.get(full_key)
        if entry:
            val, exp = entry
            if time.time() < exp:
                return val
            del _mem_cache[full_key]
        return None

    async def set(self, key: str, value: Any, ttl: int | None = None):
        full_key = f"prf:{key}"
        ttl = ttl or self.DEFAULT_TTL
        serialized = json.dumps(value, default=str)
        try:
            r = await self._r()
            if r:
                await r.setex(full_key, ttl, serialized)
                return
        except Exception:
            pass
        _mem_cache[full_key] = (value, time.time() + ttl)

    async def delete(self, pattern: str):
        full_pattern = f"prf:{pattern}"
        try:
            r = await self._r()
            if r:
                keys = await r.keys(full_pattern)
                if keys:
                    await r.delete(*keys)
                return
        except Exception:
            pass
        prefix = full_pattern.replace("*", "")
        for k in list(_mem_cache.keys()):
            if k.startswith(prefix):
                del _mem_cache[k]

    async def invalidate_user_dashboard(self, user_id):
        await self.delete(f"dashboard:{user_id}*")

    async def invalidate_questions(self):
        await self.delete("questions:*")

    async def invalidate_all(self):
        await self.delete("*")

    async def close(self):
        global _redis
        if _redis:
            await _redis.close()
            _redis = None
