"""Google Trends via SerpAPI"""
import httpx, os, logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)
SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")
BASE = "https://serpapi.com/search.json"

ECOM_KEYWORDS = [
    "projetor portatil", "escova secadora rotativa", "massageador muscular",
    "luz led magnetica", "tapete infravermelho", "organizador cabo magnetico",
    "gadget casa inteligente", "produto importado brasil", "smart home gadget",
    "fitness recovery tool",
]


class GoogleTrendsScraper:
    async def get_trending_products(self, keywords: Optional[List[str]] = None, geo="BR", timeframe="today 3-m") -> List[Dict]:
        if not SERPAPI_KEY:
            return []
        kws = keywords or ECOM_KEYWORDS
        results = []
        for i in range(0, len(kws), 5):
            batch = kws[i:i+5]
            try:
                data = await self._fetch(q=",".join(batch), geo=geo, date=timeframe, data_type="TIMESERIES")
                timeline = data.get("interest_over_time", {}).get("timeline_data", [])
                for j, kw in enumerate(batch):
                    recent = timeline[-4:] if len(timeline) >= 4 else timeline
                    vals = [d.get("values", [{}])[j].get("extracted_value", 0) if j < len(d.get("values", [])) else 0 for d in recent]
                    avg = round(sum(vals) / len(vals)) if vals else 0
                    results.append({"keyword": kw, "trend_score": avg, "geo": geo, "timeframe": timeframe,
                                    "timeline": [{"date": d.get("date",""), "value": d.get("values",[{}])[j].get("extracted_value",0) if j < len(d.get("values",[])) else 0} for d in timeline[-12:]]})
            except Exception as e:
                logger.error(f"Trends batch error: {e}")
        return results

    async def get_rising_queries(self, keyword="produtos para vender", geo="BR") -> List[Dict]:
        if not SERPAPI_KEY:
            return []
        try:
            data = await self._fetch(q=keyword, geo=geo, date="today 3-m", data_type="RELATED_QUERIES")
            rising = data.get("related_queries", {}).get("rising", [])
            return [{"query": r.get("query",""), "growth": r.get("value",""), "is_breakout": r.get("value","") == "Breakout"} for r in rising[:20]]
        except Exception as e:
            logger.error(f"Rising queries error: {e}")
            return []

    async def _fetch(self, q, geo, date, data_type) -> Dict:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(BASE, params={"engine":"google_trends","q":q,"geo":geo,"date":date,"data_type":data_type,"tz":"-180","api_key":SERPAPI_KEY})
            r.raise_for_status()
            return r.json()
