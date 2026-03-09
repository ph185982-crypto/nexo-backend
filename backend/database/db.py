"""
Database Layer v3 — PostgreSQL + Redis
Module-level pool singleton so ALL routers share one connection pool.
Bug fix: old version had broken per-instance pool that never initialized in routers.
"""
import asyncpg, json, uuid, os, logging
import redis.asyncio as aioredis
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://nexo:nexo@localhost:5432/nexo")
REDIS_URL    = os.getenv("REDIS_URL", "redis://localhost:6379")
CACHE_TTL    = 3600

# ── Module-level singletons ───────────────────────────────────────────────────
_pool:  Optional[asyncpg.Pool]      = None
_redis: Optional[aioredis.Redis]    = None


async def _get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        async def _init_conn(conn):
            await conn.set_type_codec(
                "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
            )
        _pool = await asyncpg.create_pool(
            DATABASE_URL, min_size=2, max_size=10, init=_init_conn
        )
    return _pool


async def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


class Database:
    """All methods use module-level pool — safe to instantiate anywhere."""

    async def connect(self):
        p = await _get_pool()
        await self._create_tables(p)
        logger.info("NEXO DB ready")

    async def disconnect(self):
        global _pool, _redis
        if _pool:  await _pool.close();  _pool = None
        if _redis: await _redis.close(); _redis = None

    # ── Helpers ───────────────────────────────────────────────────────────────
    async def _p(self): return await _get_pool()
    async def _r(self): return await _get_redis()

    async def _cache_get(self, key: str):
        try:
            r = await self._r()
            v = await r.get(key)
            return json.loads(v) if v else None
        except Exception: return None

    async def _cache_set(self, key: str, value):
        try:
            r = await self._r()
            await r.setex(key, CACHE_TTL, json.dumps(value, default=str))
        except Exception: pass

    async def _cache_clear(self, pattern: str):
        try:
            r = await self._r()
            keys = await r.keys(pattern)
            if keys: await r.delete(*keys)
        except Exception: pass

    # ── Table creation ────────────────────────────────────────────────────────
    async def _create_tables(self, pool: asyncpg.Pool):
        async with pool.acquire() as c:
            await c.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                    name TEXT NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS products (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    category TEXT DEFAULT 'Outros',
                    platform TEXT DEFAULT 'aliexpress',
                    price_usd FLOAT DEFAULT 0,
                    cost_brl FLOAT DEFAULT 0,
                    freight_brl FLOAT DEFAULT 0,
                    tax_brl FLOAT DEFAULT 0,
                    total_cost_brl FLOAT DEFAULT 0,
                    suggested_sell_price FLOAT DEFAULT 0,
                    markup FLOAT DEFAULT 0,
                    orders_count INT DEFAULT 0,
                    rating FLOAT DEFAULT 0,
                    br_status TEXT DEFAULT 'Não Vendido',
                    score INT DEFAULT 0,
                    opportunity INT DEFAULT 0,
                    saturation_pct INT DEFAULT 0,
                    google_trend_score INT DEFAULT 0,
                    fb_ads_count INT DEFAULT 0,
                    images JSONB DEFAULT '[]',
                    sources JSONB DEFAULT '[]',
                    br_links JSONB DEFAULT '[]',
                    tags JSONB DEFAULT '[]',
                    product_url TEXT DEFAULT '',
                    supplier_name TEXT DEFAULT '',
                    ai_analysis JSONB,
                    is_new BOOLEAN DEFAULT FALSE,
                    is_viral BOOLEAN DEFAULT FALSE,
                    highlight BOOLEAN DEFAULT FALSE,
                    growth TEXT DEFAULT '+0%',
                    delivery_days TEXT DEFAULT '14-25',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS ads (
                    id TEXT PRIMARY KEY,
                    keyword TEXT,
                    product_id TEXT,
                    title TEXT,
                    advertiser TEXT,
                    creative_type TEXT DEFAULT 'Imagem',
                    image_url TEXT DEFAULT '',
                    video_url TEXT DEFAULT '',
                    days_active INT DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    engagement TEXT DEFAULT 'Médio',
                    total_engagement INT DEFAULT 0,
                    fb_library_url TEXT DEFAULT '',
                    platform TEXT DEFAULT 'facebook',
                    raw_data JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS trends (
                    id SERIAL PRIMARY KEY,
                    keyword TEXT NOT NULL,
                    trend_score INT DEFAULT 0,
                    geo TEXT DEFAULT 'BR',
                    timeframe TEXT DEFAULT '',
                    timeline JSONB DEFAULT '[]',
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(keyword, geo)
                );
                CREATE TABLE IF NOT EXISTS favorites (
                    id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    product_id TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(user_id, product_id)
                );
                CREATE TABLE IF NOT EXISTS notifications (
                    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                    user_id TEXT NOT NULL,
                    title TEXT DEFAULT '',
                    body TEXT DEFAULT '',
                    product_id TEXT,
                    is_read BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS notif_settings (
                    user_id TEXT PRIMARY KEY,
                    email_enabled BOOLEAN DEFAULT TRUE,
                    telegram_enabled BOOLEAN DEFAULT FALSE,
                    telegram_chat_id TEXT,
                    min_score_alert INT DEFAULT 85,
                    daily_digest BOOLEAN DEFAULT TRUE
                );
                CREATE TABLE IF NOT EXISTS scan_jobs (
                    id TEXT PRIMARY KEY,
                    status TEXT DEFAULT 'pending',
                    input JSONB DEFAULT '{}',
                    result_count INT DEFAULT 0,
                    error TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_products_score    ON products(score DESC);
                CREATE INDEX IF NOT EXISTS idx_products_markup   ON products(markup DESC);
                CREATE INDEX IF NOT EXISTS idx_products_status   ON products(br_status);
                CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
                CREATE INDEX IF NOT EXISTS idx_ads_keyword       ON ads(keyword);
                CREATE INDEX IF NOT EXISTS idx_favs_user         ON favorites(user_id);
                CREATE INDEX IF NOT EXISTS idx_notifs_user       ON notifications(user_id);
            """)

    # ── USERS ─────────────────────────────────────────────────────────────────
    async def create_user(self, name: str, email: str, password_hash: str) -> Dict:
        p = await self._p()
        async with p.acquire() as c:
            row = await c.fetchrow(
                "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING *",
                name, email, password_hash
            )
        return dict(row)

    async def get_user_by_email(self, email: str) -> Optional[Dict]:
        p = await self._p()
        async with p.acquire() as c:
            row = await c.fetchrow("SELECT * FROM users WHERE email=$1", email)
        return dict(row) if row else None

    async def get_user_by_id(self, user_id: str) -> Optional[Dict]:
        p = await self._p()
        async with p.acquire() as c:
            row = await c.fetchrow("SELECT * FROM users WHERE id=$1", user_id)
        return dict(row) if row else None

    async def get_users_with_notifications(self) -> List[Dict]:
        p = await self._p()
        async with p.acquire() as c:
            rows = await c.fetch(
                "SELECT u.* FROM users u JOIN notif_settings n ON n.user_id=u.id "
                "WHERE n.email_enabled=TRUE OR n.telegram_enabled=TRUE"
            )
        return [dict(r) for r in rows]

    # ── PRODUCTS ──────────────────────────────────────────────────────────────
    async def get_products(self, category=None, min_markup=0.0, br_status=None,
                           sort_by="score", limit=50) -> List[Dict]:
        ckey = f"products:{category}:{min_markup}:{br_status}:{sort_by}:{limit}"
        cached = await self._cache_get(ckey)
        if cached:
            return cached

        p = await self._p()
        sort = {"score":"score DESC","markup":"markup DESC",
                "opportunity":"opportunity DESC","newest":"updated_at DESC"}.get(sort_by, "score DESC")
        conds, params = [], []
        if min_markup > 0:
            params.append(min_markup); conds.append(f"markup>=${len(params)}")
        if category:
            params.append(category); conds.append(f"category=${len(params)}")
        if br_status:
            params.append(br_status); conds.append(f"br_status=${len(params)}")
        params.append(limit)
        where = f"WHERE {' AND '.join(conds)}" if conds else ""
        async with p.acquire() as c:
            rows = await c.fetch(f"SELECT * FROM products {where} ORDER BY {sort} LIMIT ${len(params)}", *params)
        result = [dict(r) for r in rows]
        await self._cache_set(ckey, result)
        return result

    async def get_product_by_id(self, pid: str) -> Optional[Dict]:
        p = await self._p()
        async with p.acquire() as c:
            row = await c.fetchrow("SELECT * FROM products WHERE id=$1", pid)
        if not row: return None
        result = dict(row)
        result["ads"] = await self.get_ads(product_id=pid)
        return result

    async def upsert_products(self, products_list: List[Dict]):
        p = await self._p()
        async with p.acquire() as c:
            for prod in products_list:
                pid = prod.get("product_id") or prod.get("id") or str(uuid.uuid4())
                await c.execute("""
                    INSERT INTO products(id,title,category,platform,price_usd,cost_brl,freight_brl,
                        tax_brl,total_cost_brl,suggested_sell_price,markup,orders_count,rating,
                        br_status,score,images,sources,product_url,supplier_name,growth,updated_at)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
                    ON CONFLICT(id) DO UPDATE SET
                        score=EXCLUDED.score, markup=EXCLUDED.markup,
                        br_status=EXCLUDED.br_status, orders_count=EXCLUDED.orders_count,
                        updated_at=NOW()
                """, pid, prod.get("title",""), prod.get("category","Outros"),
                    prod.get("platform","aliexpress"), prod.get("price_usd",0),
                    prod.get("cost_brl",0), prod.get("freight_brl",0), prod.get("tax_brl",0),
                    prod.get("total_cost_brl",0), prod.get("suggested_sell_price",0),
                    prod.get("markup",0), prod.get("orders_count",0), prod.get("rating",0),
                    prod.get("br_status","Não Vendido"), prod.get("score",0),
                    json.dumps(prod.get("images",[])), json.dumps(prod.get("sources",[])),
                    prod.get("product_url",""), prod.get("supplier_name",""), prod.get("growth","+0%"))
        await self._cache_clear("products:*")

    async def save_ai_analysis(self, pid: str, analysis: Dict):
        p = await self._p()
        async with p.acquire() as c:
            await c.execute("UPDATE products SET ai_analysis=$1 WHERE id=$2", json.dumps(analysis), pid)

    async def get_products_without_ai(self, limit=10) -> List[Dict]:
        p = await self._p()
        async with p.acquire() as c:
            rows = await c.fetch(
                "SELECT * FROM products WHERE ai_analysis IS NULL ORDER BY score DESC LIMIT $1", limit)
        return [dict(r) for r in rows]

    async def get_market_gaps(self, min_opportunity=70.0) -> List[Dict]:
        p = await self._p()
        async with p.acquire() as c:
            rows = await c.fetch(
                "SELECT * FROM products WHERE br_status IN ('Não Vendido','Pouco Vendido') "
                "AND opportunity>=$1 ORDER BY opportunity DESC, score DESC LIMIT 20", min_opportunity)
        return [dict(r) for r in rows]

    # ── FAVORITES ─────────────────────────────────────────────────────────────
    async def get_favorites(self, user_id: str) -> List[Dict]:
        p = await self._p()
        async with p.acquire() as c:
            rows = await c.fetch(
                "SELECT p.* FROM products p JOIN favorites f ON f.product_id=p.id "
                "WHERE f.user_id=$1 ORDER BY f.created_at DESC", user_id)
        return [dict(r) for r in rows]

    async def toggle_favorite(self, user_id: str, product_id: str) -> bool:
        p = await self._p()
        async with p.acquire() as c:
            existing = await c.fetchrow(
                "SELECT id FROM favorites WHERE user_id=$1 AND product_id=$2", user_id, product_id)
            if existing:
                await c.execute("DELETE FROM favorites WHERE user_id=$1 AND product_id=$2", user_id, product_id)
                return False
            await c.execute("INSERT INTO favorites(user_id,product_id) VALUES($1,$2)", user_id, product_id)
            return True

    # ── ADS ───────────────────────────────────────────────────────────────────
    async def get_ads(self, keyword=None, product_id=None, active_only=True, min_days=0, limit=50) -> List[Dict]:
        p = await self._p()
        conds, params = ["days_active>=$1"], [min_days]
        if active_only: conds.append("is_active=TRUE")
        if keyword:
            params.append(f"%{keyword}%"); conds.append(f"keyword ILIKE ${len(params)}")
        if product_id:
            params.append(product_id); conds.append(f"product_id=${len(params)}")
        params.append(limit)
        async with p.acquire() as c:
            rows = await c.fetch(
                f"SELECT * FROM ads WHERE {' AND '.join(conds)} "
                f"ORDER BY days_active DESC, total_engagement DESC LIMIT ${len(params)}", *params)
        return [dict(r) for r in rows]

    async def save_ads(self, keyword: str, ads_list: List[Dict]):
        p = await self._p()
        async with p.acquire() as c:
            for ad in ads_list:
                await c.execute("""
                    INSERT INTO ads(id,keyword,title,advertiser,creative_type,image_url,video_url,
                        days_active,is_active,engagement,total_engagement,fb_library_url,platform,raw_data)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                    ON CONFLICT(id) DO UPDATE SET days_active=EXCLUDED.days_active,
                        is_active=EXCLUDED.is_active, total_engagement=EXCLUDED.total_engagement
                """, ad.get("ad_id", str(uuid.uuid4())), keyword, (ad.get("title","") or "")[:200],
                    ad.get("advertiser",""), ad.get("creative_type","Imagem"),
                    ad.get("image_url",""), ad.get("video_url",""), ad.get("days_active",0),
                    ad.get("is_active",True), ad.get("engagement","Médio"),
                    ad.get("total_engagement",0), ad.get("fb_library_url",""),
                    ad.get("platform","facebook"), json.dumps(ad))

    # ── TRENDS ────────────────────────────────────────────────────────────────
    async def upsert_trends(self, trends_list: List[Dict]):
        p = await self._p()
        async with p.acquire() as c:
            for t in trends_list:
                await c.execute("""
                    INSERT INTO trends(keyword,trend_score,geo,timeframe,timeline,updated_at)
                    VALUES($1,$2,$3,$4,$5,NOW())
                    ON CONFLICT(keyword,geo) DO UPDATE SET
                        trend_score=EXCLUDED.trend_score, timeline=EXCLUDED.timeline, updated_at=NOW()
                """, t["keyword"], t["trend_score"], t.get("geo","BR"),
                    t.get("timeframe",""), json.dumps(t.get("timeline",[])))

    async def get_trends(self, geo="BR", limit=20) -> List[Dict]:
        p = await self._p()
        async with p.acquire() as c:
            rows = await c.fetch(
                "SELECT * FROM trends WHERE geo=$1 ORDER BY trend_score DESC LIMIT $2", geo, limit)
        return [dict(r) for r in rows]

    # ── SCAN JOBS ─────────────────────────────────────────────────────────────
    async def create_scan_job(self, data: Dict) -> str:
        p = await self._p()
        scan_id = str(uuid.uuid4())
        async with p.acquire() as c:
            await c.execute(
                "INSERT INTO scan_jobs(id,status,input) VALUES($1,'pending',$2)",
                scan_id, json.dumps(data))
        return scan_id

    async def update_scan_status(self, scan_id: str, status: str, count: int = 0, error: str = None):
        p = await self._p()
        async with p.acquire() as c:
            await c.execute(
                "UPDATE scan_jobs SET status=$1,result_count=$2,error=$3,updated_at=NOW() WHERE id=$4",
                status, count, error, scan_id)

    async def get_scan_status(self, scan_id: str) -> Dict:
        p = await self._p()
        async with p.acquire() as c:
            row = await c.fetchrow("SELECT * FROM scan_jobs WHERE id=$1", scan_id)
        return dict(row) if row else {}

    # ── NOTIFICATIONS ─────────────────────────────────────────────────────────
    async def create_notification(self, user_id: str, title: str, body: str, product_id: str = None):
        p = await self._p()
        async with p.acquire() as c:
            await c.execute(
                "INSERT INTO notifications(user_id,title,body,product_id) VALUES($1,$2,$3,$4)",
                user_id, title, body, product_id)

    async def get_notifications(self, user_id: str, limit: int = 50) -> List[Dict]:
        p = await self._p()
        async with p.acquire() as c:
            rows = await c.fetch(
                "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
                user_id, limit)
        return [dict(r) for r in rows]

    async def mark_notification_read(self, notif_id: str):
        p = await self._p()
        async with p.acquire() as c:
            await c.execute("UPDATE notifications SET is_read=TRUE WHERE id=$1", notif_id)

    async def get_notif_settings(self, user_id: str) -> Optional[Dict]:
        p = await self._p()
        async with p.acquire() as c:
            row = await c.fetchrow("SELECT * FROM notif_settings WHERE user_id=$1", user_id)
        return dict(row) if row else None

    async def save_notif_settings(self, user_id: str, settings: Dict):
        p = await self._p()
        async with p.acquire() as c:
            await c.execute("""
                INSERT INTO notif_settings(user_id,email_enabled,telegram_enabled,
                    telegram_chat_id,min_score_alert,daily_digest)
                VALUES($1,$2,$3,$4,$5,$6)
                ON CONFLICT(user_id) DO UPDATE SET email_enabled=$2, telegram_enabled=$3,
                    telegram_chat_id=$4, min_score_alert=$5, daily_digest=$6
            """, user_id,
                settings.get("email_enabled", True), settings.get("telegram_enabled", False),
                settings.get("telegram_chat_id"), settings.get("min_score_alert", 85),
                settings.get("daily_digest", True))
