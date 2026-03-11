"""
NEXO Mining Scheduler v6.0 — 24/7 Zero Cost
Fontes gratuitas:
  - AliExpress DS Center (API pública, sem key)
  - Google Trends via pytrends (grátis)
  - Mercado Livre API oficial (grátis)
  - RapidAPI / Apify como OPCIONAIS para maior volume

Frequência:
  - Scan produtos: a cada 3h (8x/dia)
  - Trends: a cada 4h (6x/dia)
  - Digest campeões: a cada 6h (4x/dia)
  - Limpeza cache: a cada 12h
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import logging, os
from datetime import datetime

logger = logging.getLogger(__name__)

# ── KEYWORDS DE MINERAÇÃO ────────────────────────────────────────────────────
# Inglês → para buscar no AliExpress
MINING_KEYWORDS_EN = [
    # Saúde / Bem-estar
    "massage gun electric portable", "knee massager heat electric",
    "eye massager vibration heat", "neck massager electric cervical",
    "posture corrector back support", "cellulite massager electric body",
    "scalp massager electric waterproof", "back massager electric",
    "foot massager electric heated", "cervical traction device",
    # Beleza
    "hair straightener brush rotating", "led face mask beauty device",
    "teeth whitening led kit", "hair removal ipl device",
    "nail lamp uv gel professional", "jade roller gua sha set",
    "electric face scrubber cleaner", "eyelash curler electric heated",
    # Pet
    "automatic cat toy feather rechargeable", "dog water bottle portable filter",
    "pet grooming glove brush", "automatic pet feeder timer",
    # Bebê
    "baby nasal aspirator electric silent", "baby monitor wifi camera",
    # Fitness
    "resistance bands set workout", "foam roller muscle massage",
    "compression socks running sport", "jump rope digital counter",
    "yoga mat non slip thick",
    # Casa / Cozinha
    "portable blender bottle usb", "coffee frother electric mini",
    "plant grow light led indoor", "aroma diffuser ultrasonic",
    "steam cleaner high pressure mini",
    # Eletrônicos
    "magnetic phone holder car dashboard", "ring light selfie led",
    "mini projector portable wifi", "wireless charging pad fast",
    "smart watch fitness tracker",
]

# Português → para verificar saturação no ML e buscar trending
MINING_KEYWORDS_PT = [
    "massageador muscular portatil", "massageador joelho eletrico",
    "massageador ocular aquecimento", "massageador cervical eletrico",
    "corretor de postura invisivel", "massageador anticelulite eletrico",
    "massageador couro cabeludo eletrico", "massageador pe aquecimento",
    "escova alisadora rotativa ceramica", "mascara led facial rejuvenescimento",
    "kit clareamento dental led", "depilador ipl laser",
    "lampada uv unhas gel", "rolo jade gua sha",
    "brinquedo automatico gato pena", "garrafa agua portatil pets",
    "luva escovacao pet", "comedouro automatico pet",
    "aspirador nasal eletrico bebe", "monitor bebe wifi camera",
    "kit elasticos resistencia musculacao", "rolo espuma massagem muscular",
    "meias de compressao corrida", "corda pular digital contador",
    "tapete yoga antiderrapante grosso",
    "mini blender portatil usb", "espumador cafe eletrico mini",
    "luminaria led plantas indoor", "difusor aromaterapia ultrasonico",
    "suporte magnetico celular carro", "ring light led selfie",
    "mini projetor portatil wifi", "carregador sem fio rapido",
]

# Categorias do AliExpress DS Center para varrer
DS_CATEGORIES = [
    ("Beauty & Health",     "66"),
    ("Sports & Outdoors",   "18"),
    ("Home & Garden",       "13"),
    ("Consumer Electronics","44"),
    ("Toys & Hobbies",      "26"),
    ("Mother & Kids",       "1501"),
]


class MiningScheduler:
    """Scheduler 24/7 com fontes gratuitas de dados."""

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.stats = {
            "total_mined": 0,
            "champions": 0,
            "last_scan": None,
            "last_trends": None,
            "errors": 0,
        }

    async def start(self):
        logger.info("Iniciando NEXO Mining Scheduler v6.0 (Zero Cost)...")

        # Scan produtos a cada 3h
        self.scheduler.add_job(
            self._product_scan,
            CronTrigger(hour="*/3", minute=5, timezone="America/Sao_Paulo"),
            id="product_scan_3h",
            replace_existing=True,
        )

        # Trends a cada 4h
        self.scheduler.add_job(
            self._refresh_trends,
            CronTrigger(hour="*/4", minute=15, timezone="America/Sao_Paulo"),
            id="trends_4h",
            replace_existing=True,
        )

        # Digest campeões a cada 6h
        self.scheduler.add_job(
            self._champion_digest,
            CronTrigger(hour="0,6,12,18", minute=30, timezone="America/Sao_Paulo"),
            id="champion_digest_6h",
            replace_existing=True,
        )

        # Limpeza cache a cada 12h
        self.scheduler.add_job(
            self._cache_cleanup,
            CronTrigger(hour="0,12", minute=0, timezone="America/Sao_Paulo"),
            id="cache_cleanup_12h",
            replace_existing=True,
        )

        self.scheduler.start()
        logger.info("[OK] Mining Scheduler iniciado — 8 scans/dia, 6 trends/dia")

    async def stop(self):
        self.scheduler.shutdown()

    # ─────────────────────────────────────────────────────────────────────────
    # SCAN DE PRODUTOS — AliExpress DS Center (grátis) + RapidAPI opcional
    # ─────────────────────────────────────────────────────────────────────────
    async def _product_scan(self):
        from scrapers.aliexpress_ds import AliExpressDSScraper
        from scrapers.mercadolivre import check_br_saturation
        from services.profit_calculator import ProfitCalculator
        from database.db import Database

        start = datetime.now()
        logger.info(f"[SCAN] Iniciando mineracao {start.strftime('%H:%M')} (Sao Paulo)")

        db = Database()
        ds = AliExpressDSScraper()
        calc = ProfitCalculator()

        try:
            # 1. Bestsellers por categoria no DS Center (grátis)
            cat_products = []
            for name, cat_id in DS_CATEGORIES:
                try:
                    items = await ds.get_weekly_bestsellers(min_sales=200, limit=30)
                    cat_products.extend(items)
                    logger.info(f"  [DS] {name}: {len(items)} produtos")
                except Exception as e:
                    logger.warning(f"  [DS] {name}: {e}")

            # 2. Busca por keywords trending
            keyword_products = []
            for kw in MINING_KEYWORDS_EN[:20]:
                try:
                    items = await ds._glosearch(kw, limit=10)
                    keyword_products.extend(items)
                except Exception:
                    pass

            all_raw = cat_products + keyword_products
            logger.info(f"[SCAN] {len(all_raw)} produtos brutos coletados")

            if not all_raw:
                logger.warning("[SCAN] Nenhum produto coletado — DS Center pode estar bloqueado")
                return

            # 3. Score e filtragem
            rate = await calc.get_live_usd_rate()
            results = []
            champions = []

            seen_ids = set()
            for p in all_raw:
                pid = p.get("product_id", "") or p.get("title", "")
                if pid in seen_ids:
                    continue
                seen_ids.add(pid)

                if p.get("price_usd", 0) <= 0:
                    continue

                profit = calc.calculate(p["price_usd"], usd_brl=rate)
                if profit["markup"] < 3.0:
                    continue

                # Saturação BR via ML API oficial (grátis)
                try:
                    br_data = await check_br_saturation(p.get("title", ""))
                    br_status = br_data["br_status"]
                except Exception:
                    br_status = "Não Vendido"

                score = _score_product(p, br_status, profit)
                item = {
                    **p,
                    **profit,
                    "br_status": br_status,
                    "score": score,
                    "last_mined": datetime.now().isoformat(),
                }
                results.append(item)

                if score >= 82:
                    champions.append(item)
                    logger.info(f"  [CAMPIAO] {p.get('title','')[:50]} score={score}")

            # 4. Salvar top 200 no banco
            results.sort(key=lambda x: x["score"], reverse=True)
            if results:
                await db.upsert_products(results[:200])

            self.stats["total_mined"] += len(results)
            self.stats["champions"] += len(champions)
            self.stats["last_scan"] = datetime.now()

            elapsed = (datetime.now() - start).total_seconds()
            logger.info(f"[SCAN] Concluido: {len(results)} produtos, {len(champions)} campeoes em {elapsed:.0f}s")

        except Exception as e:
            self.stats["errors"] += 1
            logger.error(f"[SCAN] Falhou: {e}", exc_info=True)

    # ─────────────────────────────────────────────────────────────────────────
    # TRENDS — pytrends grátis + ML trending grátis
    # ─────────────────────────────────────────────────────────────────────────
    async def _refresh_trends(self):
        from scrapers.google_trends import GoogleTrendsScraper, ECOM_KEYWORDS_BR
        from scrapers.mercadolivre import MercadoLivreScraper
        from database.db import Database

        logger.info("[TRENDS] Atualizando tendencias...")
        db = Database()

        try:
            # 1. Google Trends via pytrends (grátis)
            gt = GoogleTrendsScraper()
            trends = await gt.get_trending_products(keywords=ECOM_KEYWORDS_BR, geo="BR")

            # 2. Keywords trending do ML (grátis) — acrescenta novas keywords
            ml = MercadoLivreScraper()
            ml_keywords = await ml.get_trending_keywords()
            if ml_keywords:
                # Adiciona tendências do ML com score 60 por padrão
                for kw in ml_keywords[:10]:
                    if not any(t["keyword"] == kw for t in trends):
                        trends.append({
                            "keyword": kw,
                            "trend_score": 60,
                            "geo": "BR",
                            "timeframe": "today 3-m",
                            "timeline": [],
                        })

            if trends:
                await db.upsert_trends(trends)
                self.stats["last_trends"] = datetime.now()
                logger.info(f"[TRENDS] {len(trends)} tendencias atualizadas")
            else:
                logger.warning("[TRENDS] Nenhuma tendencia coletada")

        except Exception as e:
            self.stats["errors"] += 1
            logger.error(f"[TRENDS] Falhou: {e}", exc_info=True)

    # ─────────────────────────────────────────────────────────────────────────
    # DIGEST DE CAMPEÕES
    # ─────────────────────────────────────────────────────────────────────────
    async def _champion_digest(self):
        from database.db import Database
        try:
            db = Database()
            products = await db.get_products(sort_by="score", limit=10)
            champions = [p for p in products if p.get("score", 0) >= 82]
            if champions:
                logger.info(f"[DIGEST] {len(champions)} campeoes: " +
                           ", ".join(f"{p['title'][:30]}({p['score']})" for p in champions[:3]))
        except Exception as e:
            logger.warning(f"[DIGEST] {e}")

    # ─────────────────────────────────────────────────────────────────────────
    # LIMPEZA DE CACHE
    # ─────────────────────────────────────────────────────────────────────────
    async def _cache_cleanup(self):
        from database.db import Database
        try:
            db = Database()
            await db._cache_clear("products:*")
            await db._cache_clear("trends:*")
            logger.info("[CACHE] Limpo")
        except Exception as e:
            logger.warning(f"[CACHE] {e}")

    def get_stats(self) -> dict:
        return {
            **self.stats,
            "last_scan": self.stats["last_scan"].isoformat() if self.stats["last_scan"] else None,
            "last_trends": self.stats["last_trends"].isoformat() if self.stats["last_trends"] else None,
        }


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────
def _score_product(p: dict, br_status: str, profit: dict) -> int:
    score = 0
    markup = profit.get("markup", 0)
    orders = p.get("orders_count", 0)
    rating = p.get("rating", 0)

    # Markup (30 pts)
    if markup >= 6:   score += 30
    elif markup >= 4: score += 22
    elif markup >= 3: score += 12

    # Saturação BR (25 pts)
    if br_status == "Não Vendido":    score += 25
    elif br_status == "Pouco Vendido": score += 15
    else:                              score += 5

    # Volume de pedidos (20 pts)
    if orders >= 100_000: score += 20
    elif orders >= 50_000: score += 15
    elif orders >= 10_000: score += 10
    elif orders >= 1_000:  score += 5

    # Avaliação (15 pts)
    if rating >= 4.8:   score += 15
    elif rating >= 4.5: score += 10
    elif rating >= 4.0: score += 5

    # Bônus tendência viral
    if p.get("is_viral"):  score += 5
    if p.get("is_new"):    score += 3

    return min(score, 100)


def _check_br_status(title: str, br_products: list) -> str:
    words = set(title.lower().split())
    matches = sum(
        1 for p in br_products
        if len(words & set(p.get("title", "").lower().split())) / max(len(words), 1) > 0.5
    )
    return "Não Vendido" if matches == 0 else "Pouco Vendido" if matches <= 5 else "Já Vendido"
