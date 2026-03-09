"""
AliExpress Scraper via Apify — epctex~aliexpress-scraper
"""
import httpx, os, logging
from typing import List, Dict

logger = logging.getLogger(__name__)
APIFY_TOKEN = os.getenv("APIFY_TOKEN","")
BASE = "https://api.apify.com/v2"

class AliExpressScraper:
    async def search_products(self, keywords: List[str], max_results=80, ship_to="BR") -> List[Dict]:
        all_p = []
        for kw in keywords:
            try:
                items = await self._run("epctex~aliexpress-scraper", {"searchTerms":[kw],"maxItems":max_results,"shipTo":ship_to,"currency":"USD","proxyConfiguration":{"useApifyProxy":True}})
                all_p.extend([self._norm(i) for i in items if self._valid(i)])
            except Exception as e:
                logger.error(f"AliExpress '{kw}': {e}")
        return self._dedup(all_p)

    async def _run(self, actor, inp) -> List[Dict]:
        url = f"{BASE}/acts/{actor}/run-sync-get-dataset-items?token={APIFY_TOKEN}&timeout=300&memory=1024"
        async with httpx.AsyncClient(timeout=360) as c:
            r = await c.post(url, json=inp); r.raise_for_status()
        return r.json()

    def _norm(self, i) -> Dict:
        pr = i.get("price",{}); pusd = float(pr.get("min",pr.get("value",0)) if isinstance(pr,dict) else pr or 0)
        return {"platform":"aliexpress","product_id":str(i.get("id",i.get("itemId",""))),
                "title":i.get("title",i.get("name","Unknown")),"price_usd":pusd,
                "images":i.get("images",[i.get("image","")]),
                "rating":float((i.get("rating",{}).get("averageStar",0) if isinstance(i.get("rating"),dict) else i.get("averageStarRate",0)) or 0),
                "orders_count":int(i.get("tradeCount",i.get("orders",0)) or 0),
                "product_url":i.get("url",i.get("productUrl","")),
                "supplier_name":i.get("storeName",""),"category":i.get("categoryId","")}

    def _valid(self, i) -> bool:
        pr = i.get("price",{})
        v = pr.get("min",pr.get("value",0)) if isinstance(pr,dict) else pr
        return bool(i.get("title") or i.get("name")) and float(v or 0) > 0

    def _dedup(self, items):
        seen, out = set(), []
        for p in items:
            k = p.get("product_id","") or p.get("title","")
            if k not in seen: seen.add(k); out.append(p)
        return out
