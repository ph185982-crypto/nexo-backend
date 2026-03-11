"""Mining Router — AliExpress DS Center + scheduler 24/7"""
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from database.db import Database
from routers.auth import get_current_user
import logging, os
from datetime import datetime

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/scheduler-status")
async def scheduler_status(user=Depends(get_current_user)):
    """Status do scheduler de mineração 24/7."""
    from main import scheduler
    stats = scheduler.get_stats()
    return {
        "status": "running",
        "message": "Mineracao 24/7 ativa — AliExpress DS Center + pytrends + Mercado Livre",
        "sources": {
            "aliexpress": "AliExpress DS Center (gratis)",
            "trends": "Google Trends via pytrends (gratis)",
            "br_saturation": "Mercado Livre API oficial (gratis)",
            "rapidapi": "opcional — aumenta volume se RAPIDAPI_KEY configurada",
        },
        "schedule": {
            "product_scan": "a cada 3h (8x por dia)",
            "trends_refresh": "a cada 4h (6x por dia)",
            "champion_digest": "a cada 6h (4x por dia)",
        },
        "stats": stats,
    }


@router.post("/force-scan")
async def force_scan(background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    """Dispara um scan imediato fora do agendamento."""
    from main import scheduler
    background_tasks.add_task(scheduler._product_scan)
    return {"status": "triggered", "message": "Scan iniciado em background — resultados em ~60s"}


@router.post("/force-trends")
async def force_trends(background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    """Força atualização de trends agora."""
    from main import scheduler
    background_tasks.add_task(scheduler._refresh_trends)
    return {"status": "triggered", "message": "Trends sendo atualizados..."}


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


@router.post("/hot-sync")
async def hot_sync(background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    """
    Busca os 50 produtos HOT da AliExpress True API, limpa o banco
    e repovoam com dados reais (imagens, preços, ratings).
    """
    db = Database()
    scan_id = await db.create_scan_job({"source": "aliexpress_true_api", "user_id": user["id"]})
    background_tasks.add_task(_run_hot_sync, scan_id)
    return {
        "scan_id": scan_id,
        "status": "running",
        "message": "Sincronização HOT iniciada — produtos reais em ~30s",
    }


@router.post("/import")
async def import_products(payload: dict, user=Depends(get_current_user)):
    """
    Recebe uma lista de produtos pre-mapeados e substitui o banco.
    Usado para injetar produtos coletados externamente.
    Body: {"products": [...], "clear": true}
    """
    products = payload.get("products", [])
    if not products:
        raise HTTPException(400, "Nenhum produto no payload")
    db = Database()
    if payload.get("clear", True):
        pool = await db._p()
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM products")
    await db.upsert_products(products)
    return {"status": "ok", "count": len(products), "sample": products[0].get("title") if products else None}


@router.post("/hot-sync-now")
async def hot_sync_now(user=Depends(get_current_user)):
    """
    Versão síncrona — aguarda e retorna resultados imediatamente.
    Use apenas para testes; pode atingir timeout em 60s.
    """
    from services.hot_miner import fetch_hot_products
    from services.profit_calculator import ProfitCalculator
    db = Database()
    calc = ProfitCalculator()
    try:
        rate = await calc.get_live_usd_rate()
        products = await fetch_hot_products(usd_brl=rate, limit=50)
        if not products:
            raise HTTPException(502, "True API retornou 0 produtos — verifique logs do Render para detalhes")
        # Clear old products and insert fresh ones
        pool = await db._p()
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM products")
        await db.upsert_products(products)
        return {"status": "ok", "count": len(products), "sample": products[0]["title"] if products else None}
    except Exception as e:
        raise HTTPException(500, str(e))


async def _run_hot_sync(scan_id: str):
    """Background task: fetch HOT products and replace DB contents."""
    from services.hot_miner import fetch_hot_products
    from services.profit_calculator import ProfitCalculator
    db = Database()
    try:
        await db.update_scan_status(scan_id, "fetching_true_api")
        calc = ProfitCalculator()
        rate = await calc.get_live_usd_rate()
        products = await fetch_hot_products(usd_brl=rate, limit=50)
        logger.info(f"True API retornou {len(products)} produtos")

        await db.update_scan_status(scan_id, "saving")
        # Replace all products with fresh HOT data
        pool = await db._p()
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM products")
        await db.upsert_products(products)
        await db.update_scan_status(scan_id, "completed", count=len(products))
        logger.info(f"Hot Sync concluído: {len(products)} produtos reais salvos")
    except Exception as e:
        logger.error(f"Hot Sync falhou: {e}")
        await db.update_scan_status(scan_id, "failed", error=str(e))


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
