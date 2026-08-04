"""Vercel serverless entry point — PRF Adaptive Study Platform."""
from __future__ import annotations
import os
import sys
import logging
import json
import socket
import urllib.parse
import concurrent.futures

# Make repo root importable inside Vercel's function sandbox
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Vercel Lambda EBUSY workaround
# asyncio's loop.getaddrinfo() runs socket.getaddrinfo() via ThreadPoolExecutor.
# In Vercel's Lambda sandbox that raises OSError EBUSY (errno 16).
# The identical call succeeds when made directly in the coroutine thread.
# We monkey-patch BaseEventLoop.getaddrinfo() to skip the executor entirely.
# Brief blocking (<1 ms for an IP, <100 ms for DNS) is fine in a serverless
# environment where at most one request is in flight per cold-start.
# ---------------------------------------------------------------------------
import asyncio as _asyncio
import socket as _socket

async def _sync_getaddrinfo(self, host, port, *args, **kwargs):
    return _socket.getaddrinfo(host, port, *args, **kwargs)

_asyncio.base_events.BaseEventLoop.getaddrinfo = _sync_getaddrinfo

app = FastAPI(
    title="PRF Adaptive Study Platform",
    version="1.0.0",
    description="Plataforma adaptativa para aprovação na PRF — questões CEBRASPE C/E, simulados por blocos e scanner de redação.",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_prf_ready = False
_prf_pool = None
_startup_error = None
_seed_task = None
_initializing = False
_routers_registered = False


async def _run_seed_in_background(pool):
    """Seed the database in the background so cold start finishes fast."""
    try:
        from prf.seeds.seeder import seed_prf_database
        await seed_prf_database(pool)
        logger.info("[PRF] Background seed complete")
    except Exception as e:
        logger.error(f"[PRF] Background seed error: {e}")


_RENDER_REGIONS = ["oregon", "ohio", "frankfurt", "singapore", "virginia"]


async def _resolve_render_url(database_url: str) -> str:
    """
    Swap Render internal hostname for the correct external hostname.

    All five Render external hostnames resolve in DNS and accept TLS connections,
    so a TLS-only or startup-message probe cannot distinguish regions — pgBouncer
    on the wrong regions silently drops the TCP connection without sending any
    PostgreSQL bytes.

    The only reliable discriminator is a real asyncpg.connect() attempt:
    - Wrong region → pgBouncer drops → ConnectionDoesNotExistError
    - Correct region → real PostgreSQL → success or a real PG error (auth, etc.)
    """
    import re
    import asyncpg as _apg

    parsed = urllib.parse.urlparse(database_url)
    host = parsed.hostname or ""

    # Only applies to Render internal pattern: dpg-{id}-a (no dots, no TLD)
    if not re.fullmatch(r"dpg-[a-z0-9]+-a", host):
        return database_url

    # Quick check: does the hostname already resolve (e.g. running on Render)?
    try:
        _socket.getaddrinfo(host, parsed.port or 5432, _socket.AF_INET, _socket.SOCK_STREAM)
        logger.info(f"[PRF] DB host {host} resolves OK (internal network)")
        return database_url
    except (socket.gaierror, OSError):
        pass

    logger.info(f"[PRF] Render internal host {host!r} unresolvable — probing regions via asyncpg")

    for region in _RENDER_REGIONS:
        ext = f"{host}.{region}-postgres.render.com"
        # Build a candidate URL with explicit port and SSL
        test_url = database_url.replace(f"@{host}", f"@{ext}:5432", 1)
        if parsed.port:
            # If original URL had a port, the replace above may double-port; normalise
            test_url = test_url.replace(f"@{ext}:5432:{parsed.port}", f"@{ext}:5432", 1)
        if "sslmode" not in test_url:
            sep = "&" if "?" in test_url else "?"
            test_url += f"{sep}sslmode=require"

        logger.info(f"[PRF] Probing region {region} ({ext})…")
        try:
            conn = await _apg.connect(test_url, statement_cache_size=0, timeout=10.0)
            await conn.close()
            logger.info(f"[PRF] Region {region}: connected — using {ext}")
            return test_url
        except _apg.exceptions.ConnectionDoesNotExistError:
            logger.info(f"[PRF] Region {region}: pgBouncer dropped (wrong region)")
        except _apg.exceptions.PostgresError as pg_e:
            # Real PostgreSQL error (auth, db-not-found, etc.) — correct region
            logger.info(f"[PRF] Region {region}: real PG response ({type(pg_e).__name__}) — using {ext}")
            return test_url
        except Exception as e:
            logger.info(f"[PRF] Region {region}: {type(e).__name__}: {e}")

    logger.warning(f"[PRF] No Render region confirmed — falling back to original URL")
    return database_url


async def _init_prf():
    """
    Lazy initializer — called on first HTTP request.

    asyncio's getaddrinfo() runs socket.getaddrinfo() in a ThreadPoolExecutor.
    In Vercel's Lambda sandbox that call raises EBUSY (errno 16). We work around
    it by resolving the database host synchronously in the event-loop coroutine
    before handing the (now IP-based) URL to asyncpg.
    """
    global _prf_ready, _prf_pool, _seed_task, _startup_error, _initializing, _routers_registered
    if _prf_ready or _initializing:
        return

    _initializing = True
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        _startup_error = "DATABASE_URL not set"
        _initializing = False
        logger.warning(f"[PRF] {_startup_error}")
        return

    try:
        import asyncio

        # Replace asyncio's thread-executor DNS with a fresh executor so any
        # stale thread-pool state from the Lambda INIT phase doesn't carry over.
        loop = asyncio.get_event_loop()
        loop.set_default_executor(concurrent.futures.ThreadPoolExecutor(max_workers=4))

        # Fix internal/unresolvable DB hostname before asyncpg touches it.
        resolved_url = await _resolve_render_url(db_url)

        from prf.app import register_prf_routers, init_prf_database

        if not _routers_registered:
            register_prf_routers(app)
            _routers_registered = True

        _prf_pool = await init_prf_database(resolved_url)
        _prf_ready = True
        logger.info("[PRF] Initialized (lazy, on first request)")
        _seed_task = asyncio.create_task(_run_seed_in_background(_prf_pool))
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        _startup_error = f"{type(e).__name__}: {e} | TRACE: {tb[-800:]}"
        logger.error(f"[PRF] Init error: {_startup_error}")
    finally:
        _initializing = False


@app.middleware("http")
async def lazy_init_middleware(request: Request, call_next):
    """Initialize DB on the very first request, not at startup."""
    if not _prf_ready and not _initializing:
        await _init_prf()
    return await call_next(request)


@app.on_event("shutdown")
async def shutdown():
    global _prf_pool
    if _prf_pool:
        await _prf_pool.close()


@app.get("/", include_in_schema=False)
async def root():
    """Serve the study app at the root URL."""
    return await serve_app()


@app.get("/status", tags=["Health"])
async def status(check_ai: bool = False):
    """Health payload. Pass ?check_ai=1 to actually call the AI providers."""
    from prf.services import llm_service

    payload = {
        "platform": "PRF Adaptive Study",
        "status": "online",
        "db": "connected" if _prf_ready else "not connected",
        "ai_providers_configured": llm_service.configured_providers(),
        "app": "/app",
        "docs": "/docs",
    }

    if check_ai:
        checks = {}
        for provider in llm_service.configured_providers():
            try:
                await llm_service._chat_with(
                    provider, [{"role": "user", "content": "ping"}], 0.0, 5, False
                )
                checks[provider] = "ok"
            except Exception as e:
                checks[provider] = f"error: {str(e)[:160]}"
        payload["ai_checks"] = checks

    return payload


@app.get("/debug/net", tags=["Debug"])
async def debug_net():
    """Diagnose network/DNS in Lambda — temporary endpoint."""
    import socket, urllib.parse
    results = {}
    # Test basic DNS (Google)
    for label, host in [("google", "google.com"), ("cloudflare", "1.1.1.1")]:
        try:
            ip = socket.gethostbyname(host)
            results[label] = ip
        except Exception as e:
            results[label] = f"{type(e).__name__}: {e}"
    # Test DB host
    db_url = os.getenv("DATABASE_URL", "")
    if db_url:
        try:
            host = urllib.parse.urlparse(db_url).hostname
            results["db_host"] = host
            ip = socket.gethostbyname(host)
            results["db_ip"] = ip
        except Exception as e:
            results["db_resolve"] = f"{type(e).__name__}: {e}"
    # Try a TCP connect to the resolved IP (bypass DNS in asyncio)
    if db_url:
        try:
            host = urllib.parse.urlparse(db_url).hostname
            port = urllib.parse.urlparse(db_url).port or 5432
            sock = socket.create_connection((host, port), timeout=5)
            results["tcp_connect"] = "ok"
            sock.close()
        except Exception as e:
            results["tcp_connect"] = f"{type(e).__name__}: {e}"
    return results


@app.get("/health", tags=["Health"])
async def health():
    payload = {"status": "online", "prf_ready": _prf_ready}
    if _startup_error:
        payload["startup_error"] = _startup_error
    return payload


_html_cache = None


@app.get("/manifest.json", tags=["PWA"])
async def serve_manifest():
    """PWA manifest — app metadata and icons."""
    manifest_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "prf", "static", "manifest.json",
    )
    with open(manifest_path, encoding="utf-8") as f:
        return json.loads(f.read())


@app.get("/sw.js", tags=["PWA"])
async def serve_sw():
    """Service Worker for PWA offline support."""
    from fastapi.responses import FileResponse
    sw_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "prf", "static", "sw.js",
    )
    return FileResponse(sw_path, media_type="application/javascript")


@app.get("/app", response_class=HTMLResponse, tags=["Frontend"])
async def serve_app():
    """Serve the complete PRF Estudo SPA application."""
    global _html_cache
    if _html_cache is None:
        html_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "prf", "static", "app.html",
        )
        with open(html_path, encoding="utf-8") as f:
            _html_cache = f.read()
    return HTMLResponse(content=_html_cache)
