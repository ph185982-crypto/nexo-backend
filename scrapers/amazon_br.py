"""Amazon BR Scraper via Apify"""
import httpx, os, logging
from typing import List, Dict

logger = logging.getLogger(__name__)
APIFY_TOKEN = os.getenv("APIFY_TOKEN", "")
BASE = "https://api.apify.com/v2"


class AmazonBRScraper:
    async def search_products(self, keywords: List[str], max_results=30) -> List[Dict]:
        all_p = []
        for kw in keywords:
            try:
                url = f"{BASE}/acts/apify~amazon-crawler/run-sync-get-dataset-items?token={APIFY_TOKEN}&timeout=240&memory=1024"
                async with httpx.AsyncClient(timeout=300) as c:
                    r = await c.post(url, json={
                        "searchKeywords": kw,
                        "country": "BR",
                        "maxItemsPerKeyword": max_results,
                        "proxyConfiguration": {"useApifyProxy": True},
                    })
                    r.raise_for_status()
                    items = r.json()
                all_p.extend([self._norm(i) for i in items if i.get("title")])
            except Exception as e:
                logger.error(f"Amazon BR '{kw}': {e}")
        return all_p

    def _norm(self, i) -> Dict:
        price_str = i.get("price", {})
        if isinstance(price_str, dict):
            price = float(price_str.get("value", 0) or 0)
        else:
            import re
            nums = re.findall(r"[\d.,]+", str(price_str))
            price = float(nums[0].replace(",", ".")) if nums else 0.0
        return {
            "platform":    "amazon_br",
            "title":       i.get("title", ""),
            "price_brl":   price,
            "rating":      float(i.get("stars", 0) or 0),
            "sales":       int(i.get("reviewsCount", 0) or 0),
            "product_url": i.get("url", ""),
            "asin":        i.get("asin", ""),
        }
