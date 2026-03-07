"""Shopee BR Scraper"""
import httpx, os, logging
from typing import List, Dict

logger = logging.getLogger(__name__)
APIFY_TOKEN = os.getenv("APIFY_TOKEN", "")
BASE = "https://api.apify.com/v2"


class ShopeeScraper:
    async def search_products(self, keywords: List[str], max_results=30) -> List[Dict]:
        all_p = []
        for kw in keywords:
            try:
                url = f"{BASE}/acts/tri_angle~shopee-search-scraper/run-sync-get-dataset-items?token={APIFY_TOKEN}&timeout=180&memory=512"
                async with httpx.AsyncClient(timeout=210) as c:
                    r = await c.post(url, json={"keyword": kw, "country": "br", "maxItems": max_results, "proxyConfiguration": {"useApifyProxy": True}})
                    r.raise_for_status()
                    items = r.json()
                all_p.extend([self._norm(i) for i in items])
            except Exception as e:
                logger.error(f"Shopee '{kw}': {e}")
        return all_p

    def _norm(self, i) -> Dict:
        return {
            "platform": "shopee_br",
            "title": i.get("name", i.get("title", "")),
            "price_brl": float(i.get("price", 0) or 0) / 100_000,
            "sales": int(i.get("historicalSold", 0) or 0),
            "product_url": f"https://shopee.com.br/product/{i.get('itemid','')}",
        }
