"""Mining Router — dispara mineração real do AliExpress DS Center"""
from fastapi import APIRouter, Depends, BackgroundTasks
from database.db import Database
from routers.auth import get_current_user
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/scan")
async def trigger_mining(background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    """Dispara varredura no AliExpress DS Center em background."""
    db = Database()
    scan_id = await db.create_scan_job({"source": "ds_center", "user_id": user["id"]})
    background_tasks.add_task(_run_mining, scan_id)
    return {"scan_id": scan_id, "status": "running", "message": "Mineração iniciada — aguarde ~60s"}


@router.get("/status/{scan_id}")
async def mining_status(scan_id: str, user=Depends(get_current_user)):
    return await Database().get_scan_status(scan_id)


async def _run_mining(scan_id: str):
    from scrapers.aliexpress_ds import AliExpressDSScraper
    from services.profit_calculator import ProfitCalculator
    from services.ai_scorer import AIScorer
    from scrapers.shopee import ShopeeScraper
    db = Database()
    try:
        await db.update_scan_status(scan_id, "scraping_aliexpress_ds")
        scraper = AliExpressDSScraper()
        products = await scraper.get_weekly_bestsellers(min_sales=500, limit=60)
        logger.info(f"DS Center retornou {len(products)} produtos")

        await db.update_scan_status(scan_id, "scoring")
        calc = ProfitCalculator()
        scorer = AIScorer()
        rate = await calc.get_live_usd_rate()

        # BR status via Shopee
        shopee = ShopeeScraper()
        br = []
        try:
            br = await shopee.search_products(["gadget", "eletronico", "beleza"], max_results=20)
        except Exception: pass

        results = []
        for p in products:
            if not p.get("price_usd") or p["price_usd"] <= 0:
                continue
            profit = calc.calculate(p["price_usd"], usd_brl=rate)
            if profit["markup"] < 2.5:
                continue
            br_status = _check_br(p["title"], br)
            score = await scorer.score_product(p, br_status, profit,
                google_trend=min(100, p.get("orders_count", 0) // 1000),
                fb_ads=5 if p.get("is_hot") else 0)
            opp_score = _opportunity_score(p, profit)
            results.append({
                **p, **profit,
                "br_status": br_status, "score": score,
                "opportunity": opp_score,
                "is_viral": p.get("is_hot", False),
                "is_new": True,
                "growth": f"+{min(999, p.get('orders_count', 0) // 500)}%",
            })

        results.sort(key=lambda x: x["score"], reverse=True)
        await db.upsert_products(results[:50])
        await db.update_scan_status(scan_id, "completed", count=len(results))
        logger.info(f"Mining concluído: {len(results)} produtos salvos")
    except Exception as e:
        logger.error(f"Mining falhou: {e}")
        await db.update_scan_status(scan_id, "failed", error=str(e))


def _opportunity_score(p: dict, profit: dict) -> int:
    """Opportunity Score = (orders / price) * crescimento estimado."""
    orders = p.get("orders_count", 0)
    price = p.get("price_usd", 1) or 1
    markup = profit.get("markup", 1)
    hot_bonus = 20 if p.get("is_hot") else 0
    raw = (orders / price) * (markup / 3) + hot_bonus
    return min(100, int(raw / 100))


def _check_br(title: str, br_products: list) -> str:
    words = set(title.lower().split())
    matches = sum(1 for p in br_products
                  if len(words & set(p.get("title","").lower().split())) / max(len(words),1) > 0.4)
    return "Não Vendido" if matches == 0 else "Pouco Vendido" if matches <= 3 else "Já Vendido"
