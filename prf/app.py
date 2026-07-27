"""
PRF Adaptive Study Platform — FastAPI application setup.
Registers all routers under the /api/prf prefix.
"""
from __future__ import annotations
import logging
from fastapi import FastAPI

import asyncpg

from prf.routers import deps
from prf.routers.auth import router as auth_router
from prf.routers.onboarding import router as onboarding_router
from prf.routers.missions import router as missions_router
from prf.routers.questions import router as questions_router
from prf.routers.reviews import router as reviews_router
from prf.routers.legal_library import router as legal_router
from prf.routers.commute import router as commute_router
from prf.routers.dashboard import router as dashboard_router
from prf.routers.ai_tutor import router as tutor_router
from prf.routers.sessions import router as sessions_router
from prf.routers.notifications import router as notifications_router
from prf.database.repository import PRFRepository

logger = logging.getLogger(__name__)

PREFIX = "/api/prf"


def register_prf_routers(app: FastAPI):
    """Register all PRF module routers on the given FastAPI app."""
    app.include_router(auth_router,          prefix=f"{PREFIX}/auth",          tags=["PRF Auth"])
    app.include_router(onboarding_router,    prefix=f"{PREFIX}/onboarding",    tags=["PRF Onboarding"])
    app.include_router(missions_router,      prefix=f"{PREFIX}/missions",      tags=["PRF Missions"])
    app.include_router(questions_router,      prefix=f"{PREFIX}/questions",     tags=["PRF Questions"])
    app.include_router(reviews_router,       prefix=f"{PREFIX}/reviews",       tags=["PRF Reviews"])
    app.include_router(legal_router,         prefix=f"{PREFIX}/legal",         tags=["PRF Legal Library"])
    app.include_router(commute_router,       prefix=f"{PREFIX}/commute",       tags=["PRF Commute"])
    app.include_router(dashboard_router,     prefix=f"{PREFIX}/dashboard",     tags=["PRF Dashboard"])
    app.include_router(tutor_router,         prefix=f"{PREFIX}/tutor",         tags=["PRF AI Tutor"])
    app.include_router(sessions_router,      prefix=f"{PREFIX}/sessions",      tags=["PRF Sessions"])
    app.include_router(notifications_router, prefix=f"{PREFIX}/notifications", tags=["PRF Notifications"])

    logger.info("[PRF] All routers registered under /api/prf")


async def init_prf_database(database_url: str) -> asyncpg.Pool:
    """Create connection pool, run schema, seed data, wire up the repository."""
    pool = await asyncpg.create_pool(database_url, min_size=2, max_size=10)

    # Run schema
    import os
    schema_path = os.path.join(os.path.dirname(__file__), "database", "schema.sql")
    async with pool.acquire() as conn:
        try:
            with open(schema_path) as f:
                schema_sql = f.read()
            await conn.execute(schema_sql)
            logger.info("[PRF] Database schema applied")
        except Exception as e:
            logger.warning(f"[PRF] Schema apply note: {e}")

    # Seed data
    try:
        from prf.seeds.seeder import seed_prf_database
        await seed_prf_database(pool)
    except Exception as e:
        logger.warning(f"[PRF] Seed note: {e}")

    # Wire up repository
    repo = PRFRepository(pool)
    deps.set_repo(repo)
    logger.info("[PRF] Repository initialized")

    # Wire up cache
    try:
        from config import REDIS_URL
        from prf.services.cache_service import PRFCacheService
        cache = PRFCacheService(redis_url=REDIS_URL)
        deps.set_cache(cache)
        logger.info("[PRF] Cache service initialized")
    except Exception as e:
        logger.warning(f"[PRF] Cache init note: {e}")

    return pool
