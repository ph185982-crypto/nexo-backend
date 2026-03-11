"""
Mercado Livre BR — API oficial gratuita (sem API key).
Verifica saturação e busca produtos trending no Brasil.
Endpoint público: https://api.mercadolibre.com/sites/MLB/search
"""
import httpx, os, logging, asyncio
from typing import List, Dict

logger = logging.getLogger(__name__)

ML_SEARCH_URL = "https://api.mercadolibre.com/sites/MLB/search"
ML_TRENDING_URL = "https://api.mercadolibre.com/trends/MLB"

HEADERS = {
    "User-Agent": "NEXO-Intelligence/1.0",
    "Accept": "application/json",
}


class MercadoLivreScraper:
    """Usa a API pública gratuita do Mercado Livre para saturação e trending."""

    async def search_products(self, keywords: List[str], max_results: int = 30) -> List[Dict]:
        """Busca produtos por keyword e retorna dados de saturação."""
        results = []
        for kw in keywords:
            try:
                data = await check_br_saturation(kw)
                results.append({
                    "title": kw,
                    "br_status": data.get("br_status", "Não Vendido"),
                    "br_total": data.get("br_total", 0),
                })
            except Exception as e:
                logger.error(f"ML '{kw}': {e}")
        return results

    async def get_trending_keywords(self) -> List[str]:
        """Retorna as keywords em tendência no Mercado Livre BR (grátis)."""
        try:
            async with httpx.AsyncClient(timeout=10, headers=HEADERS) as c:
                r = await c.get(ML_TRENDING_URL)
                r.raise_for_status()
                data = r.json()
                # API retorna lista de {"keyword": "...", "url": "..."}
                return [item.get("keyword", "") for item in data if item.get("keyword")]
        except Exception as e:
            logger.warning(f"ML trending: {e}")
            return []

    async def get_bestsellers_by_category(self, category_id: str = "MLB5672", limit: int = 50) -> List[Dict]:
        """
        Busca bestsellers do ML por categoria.
        MLB5672 = Beleza e Cuidado Pessoal
        MLB1276 = Eletrônicos
        MLB1499 = Esportes e Fitness
        MLB1459 = Ferramentas
        MLB5726 = Animais
        """
        try:
            async with httpx.AsyncClient(timeout=15, headers=HEADERS) as c:
                r = await c.get(ML_SEARCH_URL, params={
                    "category": category_id,
                    "sort": "relevance",
                    "limit": min(limit, 50),
                })
                r.raise_for_status()
                data = r.json()
                items = data.get("results", [])
                return [self._normalize(item) for item in items]
        except Exception as e:
            logger.warning(f"ML bestsellers cat {category_id}: {e}")
            return []

    def _normalize(self, item: Dict) -> Dict:
        price = float(item.get("price", 0) or 0)
        return {
            "platform": "mercadolivre",
            "product_id": str(item.get("id", "")),
            "title": item.get("title", ""),
            "price_brl": price,
            "price_usd": round(price / 6.0, 2),  # conversão aproximada
            "images": [item.get("thumbnail", "")],
            "image_url": item.get("thumbnail", ""),
            "rating": float(item.get("reviews", {}).get("rating_average", 0) or 0),
            "orders_count": int(item.get("sold_quantity", 0) or 0),
            "product_url": item.get("permalink", ""),
            "br_status": "Já Vendido",  # está no ML = já existe no BR
            "category": item.get("category_id", ""),
        }


async def check_br_saturation(keyword: str) -> dict:
    """
    Verifica saturação no Mercado Livre Brasil.
    Usa a API oficial gratuita como primário.
    Fallback para RapidAPI se RAPIDAPI_KEY estiver configurada.
    """
    # Primário: API oficial ML (grátis, sem key)
    try:
        async with httpx.AsyncClient(timeout=10, headers=HEADERS) as c:
            r = await c.get(ML_SEARCH_URL, params={
                "q": keyword,
                "limit": 1,
                "offset": 0,
            })
            if r.status_code == 200:
                data = r.json()
                total = data.get("paging", {}).get("total", 0)
                if total < 5:
                    status = "Não Vendido"
                elif total < 100:
                    status = "Pouco Vendido"
                else:
                    status = "Já Vendido"
                return {"br_status": status, "br_total": total}
    except Exception as e:
        logger.debug(f"ML API oficial '{keyword}': {e}")

    # Fallback: RapidAPI (se configurado)
    key = os.getenv("RAPIDAPI_KEY", "")
    if key:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.post(
                    "https://mercadolivresearchapi.p.rapidapi.com/",
                    headers={
                        "x-rapidapi-host": "mercadolivresearchapi.p.rapidapi.com",
                        "x-rapidapi-key": key,
                        "Content-Type": "application/json",
                    },
                    json={"limit": 10, "search": keyword},
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
            logger.warning(f"RapidAPI ML '{keyword}': {e}")

    return {"br_status": "Não Vendido", "br_total": 0}
