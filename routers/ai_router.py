"""AI Router"""
from fastapi import APIRouter, Depends, HTTPException
from database.db import Database
from routers.auth import get_current_user
from services.ai_scorer import AIScorer

router = APIRouter()

@router.post("/analyze/{product_id}")
async def analyze(product_id: str, user=Depends(get_current_user)):
    db = Database()
    product = await db.get_product_by_id(product_id)
    if not product:
        raise HTTPException(404, "Produto não encontrado")
    analysis = await AIScorer().analyze_product(product)
    await db.save_ai_analysis(product_id, analysis)
    return analysis

@router.post("/insights")
async def insights(user=Depends(get_current_user)):
    products = await Database().get_products(limit=20)
    return await AIScorer().generate_market_insights(products)

@router.post("/gap-analysis")
async def gap_analysis(user=Depends(get_current_user)):
    gaps = await Database().get_market_gaps(min_opportunity=70)
    return await AIScorer().analyze_market_gap(gaps)
