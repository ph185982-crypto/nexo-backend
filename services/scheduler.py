"""APScheduler — daily product scans, trends refresh, ads scan, digest emails"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import logging

logger = logging.getLogger(__name__)

DAILY_KEYWORDS_EN = ["mini projector portable", "hair dryer brush rotating", "massage gun compact", "led magnetic light rechargeable", "cable organizer magnetic", "smart home gadget", "wireless charging pad", "portable blender", "fitness recovery tool"]
DAILY_KEYWORDS_PT = ["projetor portatil", "escova secadora rotativa", "massageador muscular", "luz led sem fio", "organizador cabo", "gadget casa inteligente", "carregador sem fio", "blender portatil", "massageador percussivo"]


class DataScheduler:
    def __init__(self):
        self.scheduler = AsyncIOScheduler()

    async def start(self):
        self.scheduler.add_job(self._daily_product_scan, CronTrigger(hour=3, minute=0, timezone="America/Sao_Paulo"), id="daily_scan", replace_existing=True)
        self.scheduler.add_job(self._refresh_trends,     CronTrigger(hour="*/6",   timezone="America/Sao_Paulo"), id="trends_refresh", replace_existing=True)
        self.scheduler.add_job(self._daily_ads_scan,     CronTrigger(hour=6, minute=0, timezone="America/Sao_Paulo"), id="ads_scan", replace_existing=True)
        self.scheduler.add_job(self._daily_digest,       CronTrigger(hour=8, minute=0, timezone="America/Sao_Paulo"), id="daily_digest", replace_existing=True)
        self.scheduler.start()
        logger.info("Scheduler started: daily scan 3h, trends 6h, ads 6h, digest 8h BRT")

    async def stop(self):
        self.scheduler.shutdown()

    async def _daily_product_scan(self):
        from scrapers.aliexpress import AliExpressScraper
        from scrapers.shopee import ShopeeScraper
        from scrapers.mercadolivre import MercadoLivreScraper
        from services.ai_scorer import AIScorer
        from services.profit_calculator import ProfitCalculator
        from database.db import Database
        from routers.notifications import notify_new_product

        logger.info("Daily product scan starting...")
        db = Database(); ali = AliExpressScraper(); shopee = ShopeeScraper(); ml = MercadoLivreScraper(); scorer = AIScorer(); calc = ProfitCalculator()
        try:
            products = await ali.search_products(DAILY_KEYWORDS_EN, max_results=50)
            br = await shopee.search_products(DAILY_KEYWORDS_PT, max_results=20)
            br += await ml.search_products(DAILY_KEYWORDS_PT, max_results=20)
            rate = await calc.get_live_usd_rate()
            results = []
            for p in products:
                profit = calc.calculate(p["price_usd"], usd_brl=rate)
                if profit["markup"] < 3.0: continue
                br_status = _check_br_status(p["title"], br)
                score = await scorer.score_product(p, br_status, profit)
                item = {**p, **profit, "br_status": br_status, "score": score}
                results.append(item)
                if score >= 85:
                    await notify_new_product(item)
            results.sort(key=lambda x: x["score"], reverse=True)
            await db.upsert_products(results[:100])
            logger.info(f"Daily scan done: {len(results)} products")
        except Exception as e:
            logger.error(f"Daily scan failed: {e}")

    async def _refresh_trends(self):
        from scrapers.google_trends import GoogleTrendsScraper
        from database.db import Database
        try:
            trends = await GoogleTrendsScraper().get_trending_products(geo="BR")
            await Database().upsert_trends(trends)
            logger.info(f"Trends refreshed: {len(trends)}")
        except Exception as e:
            logger.error(f"Trends refresh failed: {e}")

    async def _daily_ads_scan(self):
        from scrapers.facebook_ads import FacebookAdsSpy
        try:
            spy = FacebookAdsSpy()
            for kw in DAILY_KEYWORDS_PT[:8]:
                await spy.scrape_and_save(kw)
            logger.info("Ads scan done")
        except Exception as e:
            logger.error(f"Ads scan failed: {e}")

    async def _daily_digest(self):
        """Send daily digest email to user if enabled."""
        from database.db import Database
        from routers.notifications import send_notification
        try:
            db = Database()
            products = await db.get_products(sort_by="score", limit=5)
            users = await db.get_users_with_notifications()
            for user in users:
                settings = await db.get_notif_settings(user["id"])
                if not settings or not settings.get("daily_digest"): continue
                top = products[:3]
                lines = "\n".join([f"#{i+1} {p.get('title','')[:40]} — Score {p.get('score',0)}/100 · Markup ×{p.get('markup',0):.1f}" for i, p in enumerate(top)])
                await send_notification(user=user, settings=settings, subject="📊 NEXO — Resumo diário de oportunidades", body=f"Seus 3 melhores produtos de hoje:\n\n{lines}\n\nAcesse a plataforma para ver a análise completa.")
        except Exception as e:
            logger.error(f"Daily digest failed: {e}")


def _check_br_status(title, br_products):
    words = set(title.lower().split())
    matches = sum(1 for p in br_products if len(words & set(p.get("title","").lower().split())) / max(len(words),1) > 0.5)
    return "Não Vendido" if matches == 0 else "Pouco Vendido" if matches <= 5 else "Já Vendido"
