"""Products Router — /api/products"""
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from typing import Optional, List
from database.db import Database
from routers.auth import get_current_user
from services.profit_calculator import ProfitCalculator
from pydantic import BaseModel
import uuid, logging

router = APIRouter()
logger = logging.getLogger(__name__)


class ScanRequest(BaseModel):
    keywords: List[str]
    min_markup: float = 3.0


def db() -> Database:
    return Database()


# IMPORTANTE: rotas específicas DEVEM vir ANTES de /{product_id}

@router.get("/favorites")
async def get_favorites(user=Depends(get_current_user)):
    return {"favorites": await db().get_favorites(user["id"])}


@router.post("/scan")
async def trigger_scan(req: ScanRequest, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    scan_id = await db().create_scan_job({"keywords": req.keywords, "min_markup": req.min_markup, "user_id": user["id"]})
    background_tasks.add_task(_run_full_scan, scan_id, req.keywords, req.min_markup)
    return {"scan_id": scan_id, "status": "running"}


@router.get("/scan/{scan_id}")
async def scan_status(scan_id: str, user=Depends(get_current_user)):
    return await db().get_scan_status(scan_id)


@router.get("")
async def get_products(
    category: Optional[str] = None,
    min_markup: float = 0.0,
    br_status: Optional[str] = None,
    sort_by: str = "score",
    limit: int = 50,
    user=Depends(get_current_user)
):
    products = await db().get_products(
        category=category, min_markup=min_markup,
        br_status=br_status, sort_by=sort_by, limit=limit
    )
    return {"products": products, "total": len(products)}


@router.get("/{product_id}")
async def get_product(product_id: str, user=Depends(get_current_user)):
    product = await db().get_product_by_id(product_id)
    if not product:
        raise HTTPException(404, "Produto não encontrado")
    return product


@router.get("/{product_id}/enrich")
async def enrich_product(product_id: str, user=Depends(get_current_user)):
    from services.product_enricher import enrich_product as _enrich
    product = await db().get_product_by_id(product_id)
    if not product:
        raise HTTPException(404, "Produto não encontrado")
    enriched = await _enrich(product)
    return {"product_id": product_id, **enriched}


@router.post("/{product_id}/favorite")
async def toggle_favorite(product_id: str, user=Depends(get_current_user)):
    result = await db().toggle_favorite(user["id"], product_id)
    return {"favorited": result}


async def _run_full_scan(scan_id: str, keywords: List[str], min_markup: float):
    d = Database()
    try:
        await d.update_scan_status(scan_id, "scraping_aliexpress")
        from scrapers.aliexpress import AliExpressScraper
        products = await AliExpressScraper().search_products(keywords, max_results=80)

        await d.update_scan_status(scan_id, "scraping_br_markets")
        from scrapers.mercadolivre import MercadoLivreScraper
        br = await MercadoLivreScraper().search_products(keywords)

        await d.update_scan_status(scan_id, "scoring")
        from services.ai_scorer import AIScorer
        calc = ProfitCalculator()
        scorer = AIScorer()
        rate = await calc.get_live_usd_rate()
        results = []
        for p in products:
            profit = calc.calculate(p["price_usd"], usd_brl=rate)
            if profit["markup"] < min_markup:
                continue
            br_status = _check_br_status(p["title"], br)
            score = await scorer.score_product(p, br_status, profit)
            results.append({**p, **profit, "br_status": br_status, "score": score})

        results.sort(key=lambda x: x["score"], reverse=True)
        await d.upsert_products(results[:50])
        await d.update_scan_status(scan_id, "completed", count=len(results))
    except Exception as e:
        logger.error(f"Scan {scan_id} falhou: {e}")
        await d.update_scan_status(scan_id, "failed", error=str(e))


def _check_br_status(title: str, br_products: list) -> str:
    words = set(title.lower().split())
    matches = sum(
        1 for p in br_products
        if len(words & set(p.get("title", "").lower().split())) / max(len(words), 1) > 0.5
    )
    return "Não Vendido" if matches == 0 else "Pouco Vendido" if matches <= 5 else "Já Vendido"
