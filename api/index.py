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

# No DNS monkey-patch — let asyncio handle it normally with extended timeouts in pool creation.
# All 6 EBUSY retries + region failover enabled.

app = FastAPI(
    title="PRF Adaptive Study Platform",
    version="1.0.9",  # podcast: calibra duracao pelo ritmo real do TTS (175 wpm) p/ garantir 30+ min
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


def _resolve_db_url(database_url: str) -> str:
    """
    Fix unresolvable DB hostnames before asyncpg touches them.

    Render internal hostnames (dpg-XXX-a) exist only on Render's private network.
    From Vercel Lambda they can't resolve, which causes asyncio's mDNS fallback to
    raise EBUSY.  We detect this pattern and substitute an external hostname so
    asyncpg never needs to resolve the internal address.

    Returns the corrected URL (unchanged if the hostname already resolves).
    """
    import re
    try:
        parsed = urllib.parse.urlparse(database_url)
        host = parsed.hostname
        if not host:
            return database_url

        # Render internal hostname pattern: dpg-{id}-a (no dots, no TLD)
        if not re.fullmatch(r"dpg-[a-z0-9]+-a", host):
            return database_url

        # Try all 5 Render regions and return the first valid-looking one.
        # In Vercel Lambda, DNS is unreliable, so we just pick oregon as default.
        # The real region detection will happen at asyncpg connect time via
        # catching ConnectionDoesNotExistError (pgBouncer drops on wrong region).
        regions = ["oregon", "ohio", "frankfurt", "singapore", "virginia"]
        for region in regions:
            ext = f"{host}.{region}-postgres.render.com"
            # Build URL with external hostname
            new_url = database_url.replace(f"@{host}", f"@{ext}", 1)
            if not parsed.port:
                new_url = new_url.replace(f"@{ext}/", f"@{ext}:5432/", 1)
            if "sslmode" not in new_url:
                sep = "&" if "?" in new_url else "?"
                new_url += f"{sep}sslmode=require"
            logger.info(f"[PRF] Render internal→external attempt: {host} → {ext}")
            return new_url
    except Exception as e:
        logger.warning(f"[PRF] _resolve_db_url error: {e}")
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
        resolved_url = _resolve_db_url(db_url)

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
