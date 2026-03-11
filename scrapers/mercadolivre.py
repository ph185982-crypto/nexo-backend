"""Mercado Livre BR — verificação de saturação via RapidAPI"""
import httpx, os, logging
from typing import List, Dict

logger = logging.getLogger(__name__)


class MercadoLivreScraper:
    async def search_products(self, keywords: List[str], max_results=30) -> List[Dict]:
        """Mantido para compatibilidade — retorna lista vazia se sem token."""
        results = []
        for kw in keywords:
            try:
                data = await check_br_saturation(kw)
                results.append({"title": kw, "br_status": data.get("br_status", "Não Vendido"), "br_total": data.get("br_total", 0)})
            except Exception as e:
                logger.error(f"ML '{kw}': {e}")
        return results


async def check_br_saturation(keyword: str) -> dict:
    """Verifica saturação no Mercado Livre Brasil via RapidAPI."""
    key = os.getenv("RAPIDAPI_KEY", "")
    if not key:
        return {"br_status": "Não Vendido", "br_total": 0}
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                "https://mercadolivresearchapi.p.rapidapi.com/",
                headers={
                    "x-rapidapi-host": "mercadolivresearchapi.p.rapidapi.com",
                    "x-rapidapi-key": key,
                    "Content-Type": "application/json",
                },
                json={"limit": 10, "search": keyword}
            )
            r.raise_for_status()
            data = r.json()
            total = data.get("total", 0) or len(data.get("results", []))
            if total < 5:
                status = "Não Vendido"
            elif total < 50:
                status = "Pouco Vendido"
            else:
                status = "Já Vendido"
            return {"br_status": status, "br_total": total}
    except Exception as e:
        logger.warning(f"RapidAPI ML '{keyword}': {e} — usando fallback")
        return {"br_status": "Não Vendido", "br_total": 0}
