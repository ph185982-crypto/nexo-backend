"""AI Router — análise de produtos com Gemini"""
from fastapi import APIRouter, Depends, HTTPException
from database.db import Database
from routers.auth import get_current_user
from services.ai_scorer import AIScorer

router = APIRouter()
scorer = AIScorer()


@router.post("/analyze/{product_id}")
async def analyze(product_id: str, user=Depends(get_current_user)):
    db = Database()
    product = await db.get_product_by_id(product_id)
    if not product:
        raise HTTPException(404, "Produto não encontrado")
    analysis = await scorer.analyze_product(product)
    await db.save_ai_analysis(product_id, analysis)
    return analysis


@router.post("/viability/{product_id}")
async def viability(product_id: str, user=Depends(get_current_user)):
    """Análise de viabilidade comercial: Aprovado / Reprovado + motivos."""
    db = Database()
    product = await db.get_product_by_id(product_id)
    if not product:
        raise HTTPException(404, "Produto não encontrado")
    return await scorer.check_viability(product)


@router.post("/keywords/{product_id}")
async def keywords(product_id: str, user=Depends(get_current_user)):
    """Gera palavras-chave SEO para Shopee, MercadoLivre e Google Shopping."""
    db = Database()
    product = await db.get_product_by_id(product_id)
    if not product:
        raise HTTPException(404, "Produto não encontrado")
    return await scorer.generate_keywords(product)


@router.post("/titles/{product_id}")
async def titles(product_id: str, user=Depends(get_current_user)):
    """Gera títulos magnéticos para anúncios em diferentes canais."""
    db = Database()
    product = await db.get_product_by_id(product_id)
    if not product:
        raise HTTPException(404, "Produto não encontrado")
    return await scorer.generate_titles(product)


@router.post("/bulk-analyze")
async def bulk_analyze(user=Depends(get_current_user)):
    """Analisa os 10 produtos com maior score que ainda não têm análise IA."""
    db = Database()
    products = await db.get_products_without_ai(limit=10)
    results = []
    for p in products:
        try:
            analysis = await scorer.analyze_product(p)
            await db.save_ai_analysis(p["id"], analysis)
            results.append({"id": p["id"], "title": p["title"], "status": "ok"})
        except Exception as e:
            results.append({"id": p["id"], "title": p["title"], "status": f"erro: {e}"})
    return {"analyzed": len(results), "results": results}


@router.post("/insights")
async def insights(user=Depends(get_current_user)):
    products = await Database().get_products(limit=20)
    return await scorer.generate_market_insights(products)


@router.post("/gap-analysis")
async def gap_analysis(user=Depends(get_current_user)):
    gaps = await Database().get_market_gaps(min_opportunity=70)
    return await scorer.analyze_market_gap(gaps)
