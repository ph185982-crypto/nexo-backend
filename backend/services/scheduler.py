"""APScheduler — scan a cada 12h, trends 6h, ads 12h, digest diário"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import logging

logger = logging.getLogger(__name__)

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


class DataScheduler:
    def __init__(self):
        self.scheduler = AsyncIOScheduler()

    async def start(self):
        # Scan global a cada 12h (3h e 15h BRT)
        self.scheduler.add_job(self._product_scan, CronTrigger(hour="3,15", minute=0, timezone="America/Sao_Paulo"), id="scan_12h", replace_existing=True)
        # Trends a cada 6h
        self.scheduler.add_job(self._refresh_trends, CronTrigger(hour="*/6", timezone="America/Sao_Paulo"), id="trends_6h", replace_existing=True)
        # Ads scan a cada 12h
        self.scheduler.add_job(self._ads_scan, CronTrigger(hour="6,18", minute=0, timezone="America/Sao_Paulo"), id="ads_12h", replace_existing=True)
        # Digest diário às 8h
        self.scheduler.add_job(self._daily_digest, CronTrigger(hour=8, minute=0, timezone="America/Sao_Paulo"), id="digest_8h", replace_existing=True)
        self.scheduler.start()
        logger.info("Scheduler: scan 12h (3h/15h), trends 6h, ads 12h (6h/18h), digest 8h BRT")

    async def stop(self):
        self.scheduler.shutdown()

    async def _product_scan(self):
        from scrapers.aliexpress import AliExpressScraper
        from scrapers.shopee import ShopeeScraper
        from scrapers.mercadolivre import MercadoLivreScraper
        from services.ai_scorer import AIScorer
        from services.profit_calculator import ProfitCalculator
        from database.db import Database
        from routers.notifications import notify_new_product

        logger.info("Scan global iniciado (12h cycle)...")
        db = Database(); ali = AliExpressScraper(); shopee = ShopeeScraper()
        ml = MercadoLivreScraper(); scorer = AIScorer(); calc = ProfitCalculator()
        try:
            # AliExpress (Apify se disponível)
            products = await ali.search_products(DAILY_KEYWORDS_EN, max_results=50)
            # Shopee direto (API pública)
            br = await shopee.search_products(DAILY_KEYWORDS_PT, max_results=20)
            br += await ml.search_products(DAILY_KEYWORDS_PT, max_results=20)
            rate = await calc.get_live_usd_rate()
            results = []
            for p in products:
                profit = calc.calculate(p["price_usd"], usd_brl=rate)
                if profit["markup"] < 3.0:
                    continue
                br_status = _check_br_status(p["title"], br)
                score = await scorer.score_product(p, br_status, profit)
                item = {**p, **profit, "br_status": br_status, "score": score}
                results.append(item)
                if score >= 85:
                    await notify_new_product(item)
            results.sort(key=lambda x: x["score"], reverse=True)
            await db.upsert_products(results[:100])
            logger.info(f"Scan concluído: {len(results)} produtos")
        except Exception as e:
            logger.error(f"Scan falhou: {e}")

    async def _refresh_trends(self):
        from scrapers.google_trends import GoogleTrendsScraper
        from database.db import Database
        try:
            trends = await GoogleTrendsScraper().get_trending_products(geo="BR")
            await Database().upsert_trends(trends)
            logger.info(f"Trends: {len(trends)} atualizados")
        except Exception as e:
            logger.error(f"Trends refresh: {e}")

    async def _ads_scan(self):
        from scrapers.facebook_ads import FacebookAdsSpy
        try:
            spy = FacebookAdsSpy()
            for kw in DAILY_KEYWORDS_PT[:8]:
                await spy.scrape_and_save(kw)
            logger.info("Ads scan concluído (12h cycle)")
        except Exception as e:
            logger.error(f"Ads scan: {e}")

    async def _daily_digest(self):
        from database.db import Database
        from routers.notifications import send_notification
        try:
            db = Database()
            products = await db.get_products(sort_by="score", limit=5)
            users = await db.get_users_with_notifications()
            for user in users:
                settings = await db.get_notif_settings(user["id"])
                if not settings or not settings.get("daily_digest"):
                    continue
                top = products[:3]
                lines = "\n".join([f"#{i+1} {p.get('title','')[:40]} — Score {p.get('score',0)}/100 · Markup ×{p.get('markup',0):.1f}" for i, p in enumerate(top)])
                await send_notification(user=user, settings=settings,
                    subject="📊 NEXO — Resumo diário de oportunidades",
                    body=f"Seus 3 melhores produtos de hoje:\n\n{lines}\n\nAcesse a plataforma para ver a análise completa.")
        except Exception as e:
            logger.error(f"Digest: {e}")


def _check_br_status(title, br_products):
    words = set(title.lower().split())
    matches = sum(1 for p in br_products if len(words & set(p.get("title","").lower().split())) / max(len(words),1) > 0.5)
    return "Não Vendido" if matches == 0 else "Pouco Vendido" if matches <= 5 else "Já Vendido"
