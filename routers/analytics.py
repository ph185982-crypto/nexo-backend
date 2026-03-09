"""Analytics Router — /api/analytics
Endpoints para análises de mineração, produtos campeões e Ads
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from database.db import Database
from routers.auth import get_current_user
from services.ads_analyzer import AdsAnalyzer
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


def db() -> Database:
    return Database()


# ── PRODUTOS CAMPEÕES ─────────────────────────────────────────────────────────
@router.get("/champions")
async def get_champion_products(
    limit: int = 50,
    user=Depends(get_current_user)
):
    """Retorna produtos campeões (score >= 85)."""
    try:
        products = await db().get_products(sort_by="score", limit=limit)
        champions = [p for p in products if p.get("score", 0) >= 85]
        
        return {
            "champions": champions,
            "total": len(champions),
            "average_score": sum(p.get("score", 0) for p in champions) / len(champions) if champions else 0,
            "average_markup": sum(p.get("markup", 0) for p in champions) / len(champions) if champions else 0,
        }
    except Exception as e:
        logger.error(f"Erro ao buscar campeões: {e}")
        raise HTTPException(500, "Erro ao buscar campeões")


# ── PRODUTOS COM ADS ──────────────────────────────────────────────────────────
@router.get("/products-with-ads")
async def get_products_with_ads(
    limit: int = 50,
    user=Depends(get_current_user)
):
    """Retorna produtos que têm Ads ativos."""
    try:
        analyzer = AdsAnalyzer()
        correlated = await analyzer.correlate_ads_with_products(db())
        
        # Ordenar por ads_quality_score
        correlated.sort(key=lambda x: x.get("ads_quality_score", 0), reverse=True)
        
        return {
            "products": correlated[:limit],
            "total": len(correlated),
            "average_ads_engagement": sum(p.get("ads_engagement", 0) for p in correlated) / len(correlated) if correlated else 0,
        }
    except Exception as e:
        logger.error(f"Erro ao buscar produtos com Ads: {e}")
        raise HTTPException(500, "Erro ao buscar produtos com Ads")


# ── PRODUTOS VENCEDORES ───────────────────────────────────────────────────────
@router.get("/winning-products")
async def get_winning_products(
    min_score: int = 85,
    limit: int = 50,
    user=Depends(get_current_user)
):
    """Retorna produtos vencedores (combinação de score + Ads + markup)."""
    try:
        analyzer = AdsAnalyzer()
        winners = await analyzer.identify_winning_products(db(), min_score=min_score)
        
        return {
            "winners": winners[:limit],
            "total": len(winners),
            "average_winner_score": sum(p.get("winner_score", 0) for p in winners) / len(winners) if winners else 0,
            "with_ads_count": len([p for p in winners if p.get("has_ads")]),
        }
    except Exception as e:
        logger.error(f"Erro ao buscar produtos vencedores: {e}")
        raise HTTPException(500, "Erro ao buscar produtos vencedores")


# ── ANÁLISE DE ADS ────────────────────────────────────────────────────────────
@router.get("/ads-analysis")
async def get_ads_analysis(user=Depends(get_current_user)):
    """Retorna análise de Ads e tendências."""
    try:
        analyzer = AdsAnalyzer()
        analysis = await analyzer.analyze_ads_trends(db())
        
        return {
            "analysis": analysis,
            "timestamp": "2026-03-09T12:00:00Z",
        }
    except Exception as e:
        logger.error(f"Erro ao analisar Ads: {e}")
        raise HTTPException(500, "Erro ao analisar Ads")


# ── ESTATÍSTICAS DE MINERAÇÃO ─────────────────────────────────────────────────
@router.get("/mining-stats")
async def get_mining_stats(user=Depends(get_current_user)):
    """Retorna estatísticas de mineração."""
    try:
        database = db()
        
        # Contar produtos
        all_products = await database.get_products(limit=10000)
        champions = [p for p in all_products if p.get("score", 0) >= 85]
        
        return {
            "total_products": len(all_products),
            "champion_products": len(champions),
            "average_score": sum(p.get("score", 0) for p in all_products) / len(all_products) if all_products else 0,
            "average_markup": sum(p.get("markup", 0) for p in all_products) / len(all_products) if all_products else 0,
            "products_by_status": {
                "nao_vendido": len([p for p in all_products if p.get("br_status") == "Não Vendido"]),
                "pouco_vendido": len([p for p in all_products if p.get("br_status") == "Pouco Vendido"]),
                "ja_vendido": len([p for p in all_products if p.get("br_status") == "Já Vendido"]),
            },
        }
    except Exception as e:
        logger.error(f"Erro ao buscar estatísticas: {e}")
        raise HTTPException(500, "Erro ao buscar estatísticas")


# ── PRODUTOS POR CATEGORIA ────────────────────────────────────────────────────
@router.get("/champions-by-category")
async def get_champions_by_category(user=Depends(get_current_user)):
    """Retorna produtos campeões agrupados por categoria."""
    try:
        products = await db().get_products(sort_by="score", limit=10000)
        champions = [p for p in products if p.get("score", 0) >= 85]
        
        # Agrupar por categoria
        by_category = {}
        for p in champions:
            category = p.get("category", "Outros")
            if category not in by_category:
                by_category[category] = []
            by_category[category].append(p)
        
        # Ordenar cada categoria por score
        for category in by_category:
            by_category[category].sort(key=lambda x: x.get("score", 0), reverse=True)
        
        return {
            "champions_by_category": by_category,
            "total_categories": len(by_category),
            "total_champions": len(champions),
        }
    except Exception as e:
        logger.error(f"Erro ao buscar campeões por categoria: {e}")
        raise HTTPException(500, "Erro ao buscar campeões por categoria")


# ── PRODUTOS TRENDING ─────────────────────────────────────────────────────────
@router.get("/trending-products")
async def get_trending_products(
    days: int = 7,
    limit: int = 50,
    user=Depends(get_current_user)
):
    """Retorna produtos em tendência (maior aumento de score recentemente)."""
    try:
        products = await db().get_products(sort_by="score", limit=limit)
        
        # Ordenar por score descendente (produtos com maior score são "trending")
        products.sort(key=lambda x: x.get("score", 0), reverse=True)
        
        return {
            "trending": products[:limit],
            "total": len(products),
            "period_days": days,
        }
    except Exception as e:
        logger.error(f"Erro ao buscar produtos trending: {e}")
        raise HTTPException(500, "Erro ao buscar produtos trending")


# ── OPORTUNIDADES DE MERCADO ──────────────────────────────────────────────────
@router.get("/market-opportunities")
async def get_market_opportunities(user=Depends(get_current_user)):
    """Retorna oportunidades de mercado (produtos não vendidos com bom score)."""
    try:
        products = await db().get_products(sort_by="score", limit=10000)
        
        # Filtrar: score >= 75 e não vendido no Brasil
        opportunities = [
            p for p in products
            if p.get("score", 0) >= 75 and p.get("br_status") == "Não Vendido"
        ]
        
        # Ordenar por score
        opportunities.sort(key=lambda x: x.get("score", 0), reverse=True)
        
        return {
            "opportunities": opportunities[:50],
            "total": len(opportunities),
            "average_score": sum(p.get("score", 0) for p in opportunities) / len(opportunities) if opportunities else 0,
            "average_markup": sum(p.get("markup", 0) for p in opportunities) / len(opportunities) if opportunities else 0,
        }
    except Exception as e:
        logger.error(f"Erro ao buscar oportunidades: {e}")
        raise HTTPException(500, "Erro ao buscar oportunidades")
