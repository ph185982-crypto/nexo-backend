"""Shopee BR Scraper — API pública direta (sem Apify) + fallback Apify"""
import httpx, os, logging, asyncio
from typing import List, Dict

logger = logging.getLogger(__name__)
APIFY_TOKEN = os.getenv("APIFY_TOKEN", "")
BASE_APIFY = "https://api.apify.com/v2"

TRENDING_KEYWORDS = [
    "projetor portatil", "escova secadora rotativa", "massageador muscular",
    "carregador sem fio", "luz led ring", "mini blender", "suporte celular",
    "fone bluetooth", "camara espia", "tapete yoga"
]

SHOPEE_SEARCH_URL = "https://shopee.com.br/api/v4/search/search_items"
SHOPEE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://shopee.com.br/",
    "X-Shopee-Language": "pt-BR",
}


class ShopeeScraper:
    async def search_products(self, keywords: List[str], max_results=30) -> List[Dict]:
        all_p = []
        for kw in keywords:
            try:
                items = await self._search_direct(kw, max_results)
                if not items and APIFY_TOKEN:
                    items = await self._search_apify(kw, max_results)
                all_p.extend(items)
            except Exception as e:
                logger.error(f"Shopee '{kw}': {e}")
        return all_p

    async def get_trending(self, limit=50) -> List[Dict]:
        """Busca os mais vendidos da Shopee BR usando keywords de tendência."""
        return await self.search_products(TRENDING_KEYWORDS[:5], max_results=limit // 5)

    async def _search_direct(self, keyword: str, limit: int) -> List[Dict]:
        params = {
            "by": "sales", "keyword": keyword, "limit": min(limit, 30),
            "newest": 0, "order": "desc", "page_type": "search",
            "scenario": "PAGE_GLOBAL_SEARCH", "version": 2,
        }
        async with httpx.AsyncClient(timeout=20, headers=SHOPEE_HEADERS) as c:
            r = await c.get(SHOPEE_SEARCH_URL, params=params)
            r.raise_for_status()
            data = r.json()
        items = data.get("items", [])
        return [self._norm(i) for i in items if i]

    async def _search_apify(self, keyword: str, limit: int) -> List[Dict]:
        url = f"{BASE_APIFY}/acts/tri_angle~shopee-search-scraper/run-sync-get-dataset-items?token={APIFY_TOKEN}&timeout=180&memory=512"
        async with httpx.AsyncClient(timeout=210) as c:
            r = await c.post(url, json={"keyword": keyword, "country": "br", "maxItems": limit, "proxyConfiguration": {"useApifyProxy": True}})
            r.raise_for_status()
            return [self._norm_apify(i) for i in r.json()]

    def _norm(self, i: Dict) -> Dict:
        item = i.get("item_basic", i)
        price_raw = item.get("price", item.get("price_min", 0))
        price_brl = float(price_raw or 0) / 100_000
        images = item.get("images", [])
        img_url = f"https://cf.shopee.com.br/file/{images[0]}" if images else ""
        return {
            "platform": "shopee_br",
            "product_id": str(item.get("itemid", item.get("item_id", ""))),
            "title": item.get("name", item.get("title", "")),
            "price_brl": round(price_brl, 2),
            "price_usd": round(price_brl / 5.9, 2),
            "sales": int(item.get("historical_sold", item.get("sold", 0)) or 0),
            "rating": float(item.get("item_rating", {}).get("rating_star", 0) or 0),
            "images": [img_url] if img_url else [],
            "orders_count": int(item.get("historical_sold", 0) or 0),
            "product_url": f"https://shopee.com.br/product/{item.get('shopid','')}/{item.get('itemid','')}",
        }

    def _norm_apify(self, i: Dict) -> Dict:
        return {
            "platform": "shopee_br",
            "title": i.get("name", i.get("title", "")),
            "price_brl": float(i.get("price", 0) or 0) / 100_000,
            "price_usd": float(i.get("price", 0) or 0) / 100_000 / 5.9,
            "sales": int(i.get("historicalSold", 0) or 0),
            "orders_count": int(i.get("historicalSold", 0) or 0),
            "images": [],
            "product_url": f"https://shopee.com.br/product/{i.get('itemid','')}",
        }
