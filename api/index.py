"""Vercel serverless entry point — PRF Adaptive Study Platform."""
from __future__ import annotations
import os
import sys
import logging

# Make repo root importable inside Vercel's function sandbox
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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


@app.on_event("startup")
async def startup():
    global _prf_ready, _prf_pool
    if _prf_ready:
        return

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        logger.warning("[PRF] DATABASE_URL not set — running without database")
        return

    try:
        from prf.app import register_prf_routers, init_prf_database
        register_prf_routers(app)
        _prf_pool = await init_prf_database(db_url)
        _prf_ready = True
        logger.info("[PRF] Initialized on Vercel")
    except Exception as e:
        logger.error(f"[PRF] Startup error: {e}")


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
async def status():
    from prf.services import llm_service
    return {
        "platform": "PRF Adaptive Study",
        "status": "online",
        "db": "connected" if _prf_ready else "not connected",
        "ai_provider": llm_service.active_provider() or "none",
        "app": "/app",
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "online", "prf_ready": _prf_ready}


_html_cache = None


@app.get("/app", response_class=HTMLResponse, tags=["Frontend"])
async def serve_app():
    global _html_cache
    if _html_cache is None:
        html_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "prf", "static", "app.html",
        )
        with open(html_path, encoding="utf-8") as f:
            _html_cache = f.read()
    return HTMLResponse(content=_html_cache)
