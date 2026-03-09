"""
NEXO — Configuração Centralizada
Todas as variáveis de ambiente e constantes em um único lugar.
"""
import os
from typing import List

# ── VERSÃO ────────────────────────────────────────────────────────────────────
VERSION = "4.4.0"
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

# ── BANCO DE DADOS ────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://nexo:nexo@localhost:5432/nexo")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
CACHE_TTL = 3600  # 1 hora

# ── IA ────────────────────────────────────────────────────────────────────────
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_MODEL = "gemini-2.5-flash"

# ── SCRAPING ──────────────────────────────────────────────────────────────────
APIFY_TOKEN = os.getenv("APIFY_TOKEN", "")
SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")
RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "")

# ── META ADS ──────────────────────────────────────────────────────────────────
META_ADS_TOKEN = os.getenv("META_ADS_TOKEN", "")
META_AD_ACCOUNT_ID = os.getenv("META_AD_ACCOUNT_ID", "")
META_API_VERSION = "v18.0"

# ── AUTH ──────────────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
TOKEN_EXPIRATION = 7 * 24 * 60 * 60  # 7 dias em segundos

# ── EMAIL ─────────────────────────────────────────────────────────────────────
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")

# ── TELEGRAM ──────────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

# ── CÂMBIO ────────────────────────────────────────────────────────────────────
USD_TO_BRL_FALLBACK = float(os.getenv("USD_TO_BRL_FALLBACK", "6.10"))

# ── SERVIDOR ──────────────────────────────────────────────────────────────────
PORT = int(os.getenv("PORT", "8000"))
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

# ── MODO DEMO ─────────────────────────────────────────────────────────────────
# Detecta se as APIs críticas estão configuradas
DEMO_MODE = not all([
    APIFY_TOKEN,
    GOOGLE_API_KEY,
    REDIS_URL and REDIS_URL != "redis://localhost:6379"
])

# ── KEYWORDS PARA SCHEDULER ──────────────────────────────────────────────────
DAILY_KEYWORDS_EN = [
    "mini projector portable", "hair dryer brush rotating", "massage gun compact",
    "led magnetic light rechargeable", "cable organizer magnetic", "smart home gadget",
    "wireless charging pad", "portable blender", "fitness recovery tool",
    "ring light selfie", "neck massager electric", "smart watch fitness",
]

DAILY_KEYWORDS_PT = [
    "projetor portatil", "escova secadora rotativa", "massageador muscular",
    "luz led sem fio", "organizador cabo", "gadget casa inteligente",
    "carregador sem fio", "blender portatil", "massageador percussivo",
    "ring light", "massageador cervical", "relogio inteligente",
]

# ── LIMITES ───────────────────────────────────────────────────────────────────
MAX_PRODUCTS_PER_SCAN = 100
MAX_SCAN_JOBS_PER_USER = 10
MIN_MARKUP_THRESHOLD = 3.0
MIN_SCORE_THRESHOLD = 75

# ── TIMEOUTS ──────────────────────────────────────────────────────────────────
APIFY_TIMEOUT = 300  # 5 minutos
SCRAPER_TIMEOUT = 60  # 1 minuto
API_TIMEOUT = 30  # 30 segundos

# ── LOGGING ───────────────────────────────────────────────────────────────────
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"


def get_config_summary() -> dict:
    """Get summary of current configuration."""
    return {
        "version": VERSION,
        "environment": ENVIRONMENT,
        "demo_mode": DEMO_MODE,
        "apis_configured": {
            "apify": bool(APIFY_TOKEN),
            "google": bool(GOOGLE_API_KEY),
            "redis": bool(REDIS_URL and REDIS_URL != "redis://localhost:6379"),
            "meta": bool(META_ADS_TOKEN),
            "serpapi": bool(SERPAPI_KEY),
            "rapidapi": bool(RAPIDAPI_KEY),
        },
        "database": "postgresql",
        "cache": "redis" if REDIS_URL and REDIS_URL != "redis://localhost:6379" else "memory",
        "auth": "jwt",
        "port": PORT,
    }
