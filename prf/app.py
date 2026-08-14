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
from prf.routers.taf import router as taf_router
from prf.routers.checklist import router as checklist_router
from prf.routers.plano import router as plano_router
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
    app.include_router(taf_router,           prefix=f"{PREFIX}/taf",            tags=["PRF TAF"])
    app.include_router(checklist_router,     prefix=f"{PREFIX}/checklist",      tags=["PRF Checklist"])
    app.include_router(plano_router,         prefix=f"{PREFIX}/plano",          tags=["PRF Plano"])

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
    import asyncio
    import re
    import urllib.parse
    import socket

    # Resolução antecipada do hostname — só para aquecer o DNS do Lambda, cuja
    # queda para mDNS provoca EBUSY na primeira conexão.
    #
    # NÃO se troca o hostname por IP no DSN. O Postgres gerenciado (Render, e
    # o mesmo vale para Neon e Supabase) roteia a conexão pelo nome enviado no
    # SNI do handshake TLS: conectando por IP não há nome nenhum, o proxy não
    # sabe para qual banco encaminhar e fecha a conexão no meio da negociação.
    # O sintoma é exatamente `ConnectionDoesNotExistError: connection was
    # closed in the middle of operation`, repetido nas dez tentativas — foi o
    # que derrubou o boot em produção. O IP fica guardado só como plano B, e
    # entra apenas se o erro for de resolução de nome, que é o problema que a
    # substituição pretendia resolver.
    parsed = urllib.parse.urlparse(database_url)
    hostname = parsed.hostname
    resolved_ip = None
    ip_url = None

    if hostname:
        try:
            socket.setdefaulttimeout(5.0)
            resolved_ip = socket.gethostbyname(hostname)
            ip_url = database_url.replace(f"@{hostname}", f"@{resolved_ip}", 1)
            logger.info(f"[PRF] DNS aquecido: {hostname} → {resolved_ip} (conectando pelo nome)")
        except Exception as e:
            logger.warning(f"[PRF] Não resolveu {hostname}: {e}; segue pelo nome mesmo assim")

    # Log sanitized URL for debugging (hide credentials)
    safe_url = f"{parsed.scheme}://user@{parsed.hostname}:{parsed.port or 5432}{parsed.path}?..."
    logger.info(f"[PRF] Connecting to DB: {safe_url} (full url length={len(database_url)})")

    # Aggressive retry loop for transient DNS/network issues in Lambda
    pool = None
    last_error = None

    # DSN em uso. Só vira o do IP se o erro for de resolução de nome — ver o
    # comentário sobre SNI acima.
    dsn = database_url

    for attempt in range(10):  # 10 attempts with exponential backoff (up to 60s total)
        try:
            logger.info(f"[PRF] Connection attempt {attempt + 1}/10…")

            # Wrap connection in timeout to fail fast on DNS hangs
            pool = await asyncio.wait_for(
                asyncpg.create_pool(
                    dsn,
                    min_size=1,
                    max_size=5,
                    statement_cache_size=0,
                    init=_init_connection,
                    command_timeout=10.0,
                ),
                timeout=15.0  # Total timeout per attempt: 15 seconds
            )
            logger.info(f"[PRF] Connected to database on attempt {attempt + 1}")
            break
        except asyncio.TimeoutError:
            logger.warning(f"[PRF] Connection timeout on attempt {attempt + 1}/10")
            last_error = asyncio.TimeoutError("Connection timeout")
            if attempt < 9:
                wait = min(2 ** attempt, 32)  # Exponential backoff: 1,2,4,8,16,32
                logger.info(f"[PRF] Retrying in {wait}s…")
                await asyncio.sleep(wait)
        except OSError as e:
            if e.errno == 16:  # EBUSY
                logger.warning(f"[PRF] EBUSY on attempt {attempt + 1}/10 (DNS resolver busy)")
            else:
                logger.warning(f"[PRF] OSError on attempt {attempt + 1}/10: {e}")
            # Falha de nome (gaierror) ou resolver ocupado: aí sim o IP ajuda,
            # e é o único caso em que perder o SNI é melhor que não conectar.
            if ip_url and dsn is database_url and (
                isinstance(e, socket.gaierror) or e.errno in (16, -2, -3, -5)
            ):
                dsn = ip_url
                logger.warning(f"[PRF] Falha de DNS; passando a conectar por IP ({resolved_ip})")
            last_error = e
            if attempt < 9:
                wait = min(2 ** attempt, 32)
                logger.info(f"[PRF] Retrying in {wait}s…")
                await asyncio.sleep(wait)
        except Exception as e:
            logger.error(f"[PRF] Unexpected error on attempt {attempt + 1}/10: {type(e).__name__}: {e}")
            last_error = e
            if attempt < 9:
                wait = min(2 ** attempt, 32)
                await asyncio.sleep(wait)

    if not pool:
        raise last_error or Exception("Failed to connect to database after 10 attempts")

    logger.info("[PRF] DB pool created")

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

    # Wire up repository before seeding so requests can be served immediately.
    # Seeding runs as a background task on the first request to avoid blocking
    # the cold start beyond Vercel's 60-second function limit.
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
