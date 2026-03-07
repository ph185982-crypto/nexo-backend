"""
1688 Scraper via Apify — epctex~1688-scraper
Chinese wholesale marketplace — cheapest source prices
"""
import httpx, os, logging, re
from typing import List, Dict

logger = logging.getLogger(__name__)
APIFY_TOKEN = os.getenv("APIFY_TOKEN", "")
BASE = "https://api.apify.com/v2"

class Scraper1688:
    async def search_products(self, keywords: List[str], max_results=50) -> List[Dict]:
        all_p = []
        for kw in keywords:
            try:
                url = f"{BASE}/acts/epctex~1688-scraper/run-sync-get-dataset-items?token={APIFY_TOKEN}&timeout=300&memory=1024"
                inp = {"searchTerms": [kw], "maxItems": max_results, "proxyConfiguration": {"useApifyProxy": True}}
                async with httpx.AsyncClient(timeout=360) as c:
                    r = await c.post(url, json=inp); r.raise_for_status()
                    items = r.json()
                all_p.extend([self._norm(i) for i in items if i.get("title")])
            except Exception as e:
                logger.error(f"1688 '{kw}': {e}")
        return all_p

    def _norm(self, i) -> Dict:
        # 1688 prices are in CNY — convert to USD estimate (~7.2 CNY/USD)
        price_cny = 0.0
        raw = i.get("price", "")
        if isinstance(raw, (int, float)):
            price_cny = float(raw)
        elif isinstance(raw, str):
            nums = re.findall(r"[\d.]+", raw)
            price_cny = float(nums[0]) if nums else 0.0
        price_usd = round(price_cny / 7.2, 2)
        return {
            "platform":     "1688",
            "product_id":   str(i.get("offerId", i.get("id", ""))),
            "title":        i.get("title", ""),
            "price_usd":    price_usd,
            "price_cny":    price_cny,
            "moq":          i.get("minOrderQuantity", 1),
            "images":       i.get("images", [i.get("image", "")]),
            "rating":       float(i.get("repurchaseRate", 0) or 0),
            "orders_count": int(i.get("tradeCount", 0) or 0),
            "product_url":  i.get("url", ""),
            "supplier_name": i.get("companyName", ""),
            "category":     i.get("category", ""),
        }
