"""Mercado Livre BR Scraper"""
import httpx, os, logging
from typing import List, Dict

logger = logging.getLogger(__name__)
APIFY_TOKEN = os.getenv("APIFY_TOKEN", "")
BASE = "https://api.apify.com/v2"


class MercadoLivreScraper:
    async def search_products(self, keywords: List[str], max_results=30) -> List[Dict]:
        all_p = []
        for kw in keywords:
            try:
                url = f"{BASE}/acts/jupri~mercado-libre-scraper/run-sync-get-dataset-items?token={APIFY_TOKEN}&timeout=180&memory=512"
                async with httpx.AsyncClient(timeout=210) as c:
                    r = await c.post(url, json={"search": kw, "site": "MLB", "maxItems": max_results, "proxyConfiguration": {"useApifyProxy": True}})
                    r.raise_for_status()
                    items = r.json()
                all_p.extend([self._norm(i) for i in items])
            except Exception as e:
                logger.error(f"ML '{kw}': {e}")
        return all_p

    def _norm(self, i) -> Dict:
        return {
            "platform": "mercadolivre_br",
            "title": i.get("title", ""),
            "price_brl": float(i.get("price", 0) or 0),
            "sales": int(i.get("soldQuantity", 0) or 0),
            "product_url": i.get("url", ""),
        }
