"""
NEXO — Product Intelligence Platform
Backend API v4.3 — AliExpress True API, /import endpoint, image proxy
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import logging, os

load_dotenv()

from database.db import Database
from services.scheduler_mining import MiningScheduler
from routers import products, trends, ads, gaps, calculator, ai_router, auth, notifications, export, download, mining, meta_ads

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="NEXO API", version="3.0.0")

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allow all origins in development. In production set ALLOWED_ORIGINS env var.
_origins_env = os.getenv("ALLOWED_ORIGINS", "*")
_vercel = "https://frontend-mu-eight-47.vercel.app"
if _origins_env == "*":
    _origins = ["*"]
else:
    _origins = list({*_origins_env.split(","), _vercel})

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

db        = Database()
scheduler = MiningScheduler()


@app.on_event("startup")
async def startup():
    await db.connect()
    await scheduler.start()
    from services.seeder import seed_if_empty
    seeded = await seed_if_empty(db)
    if seeded:
        logger.info(f"Seed inicial: {seeded} produtos inseridos")
    logger.info("[OK] NEXO Mining v6.0 iniciado — 24/7 Zero Cost")


@app.on_event("shutdown")
async def shutdown():
    await db.disconnect()
    await scheduler.stop()


# Routers
app.include_router(auth.router,          prefix="/api/auth",          tags=["Auth"])
app.include_router(products.router,      prefix="/api/products",      tags=["Products"])
app.include_router(trends.router,        prefix="/api/trends",        tags=["Trends"])
app.include_router(ads.router,           prefix="/api/ads",           tags=["Ads"])
app.include_router(gaps.router,          prefix="/api/gaps",          tags=["Market Gap"])
app.include_router(calculator.router,    prefix="/api/calculator",    tags=["Calculator"])
app.include_router(ai_router.router,     prefix="/api/ai",            tags=["AI"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(export.router,        prefix="/api/export",        tags=["Export"])
app.include_router(download.router,      prefix="/api/download",      tags=["Download"])
app.include_router(mining.router,        prefix="/api/mining",        tags=["Mining"])
app.include_router(meta_ads.router,      prefix="/api/meta",           tags=["Meta Ads"])

# ── NEXO Mining v5.0 Analytics Router ─────────────────────────────────────────
from routers.analytics import router as analytics_router
app.include_router(analytics_router, prefix="/api/analytics", tags=["Analytics"])


@app.get("/health")
async def health():
    return {"status": "online", "version": "6.0.0", "mining": "24/7 active"}


