"""Vercel serverless entry point — PRF Adaptive Study Platform."""
from __future__ import annotations
import os
import sys
import logging

# Make repo root importable inside Vercel's function sandbox
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
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


@app.get("/", tags=["Health"])
async def root():
    return {
        "platform": "PRF Adaptive Study",
        "status": "online",
        "db": "connected" if _prf_ready else "not connected",
        "docs": "/docs",
        "endpoints": "/api/prf/...",
    }


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "online", "prf_ready": _prf_ready}
