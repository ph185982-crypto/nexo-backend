"""
Alibaba Scraper via Apify — epctex~alibaba-scraper
Finds wholesale suppliers with MOQ and bulk prices
"""
import httpx, os, logging
from typing import List, Dict

logger = logging.getLogger(__name__)
APIFY_TOKEN = os.getenv("APIFY_TOKEN","")
BASE = "https://api.apify.com/v2"
ACTOR = "epctex~alibaba-scraper"

class AlibabaScraper:
    async def search_products(self, keywords: List[str], max_results=50) -> List[Dict]:
        all_p = []
        for kw in keywords:
            try:
                url = f"{BASE}/acts/{ACTOR}/run-sync-get-dataset-items?token={APIFY_TOKEN}&timeout=300&memory=1024"
                inp = {"searchTerms":[kw],"maxItems":max_results,"proxyConfiguration":{"useApifyProxy":True}}
                async with httpx.AsyncClient(timeout=360) as c:
                    r = await c.post(url, json=inp); r.raise_for_status()
                    items = r.json()
                all_p.extend([self._norm(i) for i in items if i.get("title")])
            except Exception as e:
                logger.error(f"Alibaba '{kw}': {e}")
        return all_p

    def _norm(self, i) -> Dict:
        pr = i.get("price",{})
        if isinstance(pr, dict): price = float(pr.get("min",0) or 0)
        elif isinstance(pr, str):
            import re; nums = re.findall(r"[\d.]+", pr)
            price = float(nums[0]) if nums else 0.0
        else: price = float(pr or 0)
        return {
            "platform":      "alibaba",
            "product_id":    str(i.get("productId",i.get("id",""))),
            "title":         i.get("title",""),
            "price_usd":     price,
            "moq":           i.get("minOrderQuantity",i.get("moq",1)),
            "images":        i.get("images",[i.get("image","")]),
            "rating":        float(i.get("supplierRating",i.get("rating",0)) or 0),
            "orders_count":  int(i.get("transactionLevel",0) or 0),
            "product_url":   i.get("detailUrl",i.get("url","")),
            "supplier_name": i.get("companyName",i.get("supplierName","")),
            "supplier_country": i.get("country","CN"),
            "category":      i.get("category",""),
        }
