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
from prf.routers.essays import router as essays_router
from prf.routers.simulados import router as simulados_router
from prf.routers.content_generator import router as generator_router
from prf.routers.maintenance import router as maintenance_router
from prf.routers.trilha import router as trilha_router
from prf.routers.cron import router as cron_router
from prf.routers.coverage import router as coverage_router
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
    app.include_router(essays_router,        prefix=f"{PREFIX}/essays",         tags=["PRF Essays"])
    app.include_router(simulados_router,     prefix=f"{PREFIX}/simulados",      tags=["PRF Simulados"])
    app.include_router(generator_router,     prefix=f"{PREFIX}/generate",       tags=["PRF Content Generation"])
    app.include_router(maintenance_router,   prefix=f"{PREFIX}/maintenance",    tags=["PRF Maintenance"])
    app.include_router(trilha_router,        prefix=f"{PREFIX}/trilha",         tags=["PRF Trilha do Edital"])
    app.include_router(cron_router,          prefix=f"{PREFIX}/cron",           tags=["PRF Agendador"])
    app.include_router(coverage_router,      prefix=f"{PREFIX}/coverage",       tags=["PRF Coverage Audit"])

    logger.info("[PRF] All routers registered under /api/prf")


async def _init_connection(conn: asyncpg.Connection):
    """Decode JSONB to Python objects and encode them back on write.

    Without this asyncpg hands JSONB back as raw text, which then fails
    validation against list/dict fields in the Pydantic response models.
    """
    import json

    for typename in ("json", "jsonb"):
        await conn.set_type_codec(
            typename,
            encoder=lambda v: json.dumps(v, ensure_ascii=False),
            decoder=json.loads,
            schema="pg_catalog",
        )


async def init_prf_database(database_url: str) -> asyncpg.Pool:
    """Create connection pool, run schema, seed data, wire up the repository."""
    pool = await asyncpg.create_pool(
        database_url,
        min_size=1,
        max_size=5,
        statement_cache_size=0,  # required for Supabase pgBouncer (transaction mode)
        init=_init_connection,
    )

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

    # Alterações de esquema posteriores ao schema.sql, que num banco já povoado
    # nunca chegam a rodar (o lote aborta no primeiro CREATE TABLE duplicado).
    try:
        from prf.database.migrations import apply_migrations
        await apply_migrations(pool)
    except Exception as e:
        logger.warning(f"[PRF] Migration note: {e}")

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
