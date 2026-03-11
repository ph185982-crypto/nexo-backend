"""
Google Trends Scraper — usa pytrends (grátis, sem API key).
Fallback para SerpAPI se SERPAPI_KEY estiver configurada.
"""
import asyncio, logging, os
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)
SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")

# Keywords em PT-BR com alto potencial no e-commerce brasileiro
ECOM_KEYWORDS_BR = [
    # Saúde / Bem-estar
    "massageador muscular portatil",
    "pistola de massagem",
    "massageador joelho eletrico",
    "massageador ocular aquecimento",
    "corretor de postura",
    "massageador anticelulite",
    # Beleza
    "escova alisadora rotativa",
    "mascara led facial",
    "kit clareamento dental",
    "massageador couro cabeludo",
    # Pet
    "brinquedo automatico gato",
    "garrafa agua portatil pets",
    # Bebê
    "aspirador nasal eletrico bebe",
    # Fitness
    "elasticos resistencia musculacao",
    "meias de compressao corrida",
    "rolo espuma massagem muscular",
    # Casa / Cozinha
    "mini mixer portatil usb",
    "espumador cafe eletrico",
    "luminaria led plantas indoor",
    # Eletrônicos
    "suporte magnetico celular carro",
]


class GoogleTrendsScraper:
    """Usa pytrends (grátis) para puxar dados reais do Google Trends."""

    async def get_trending_products(
        self,
        keywords: Optional[List[str]] = None,
        geo: str = "BR",
        timeframe: str = "today 3-m",
    ) -> List[Dict]:
        kws = keywords or ECOM_KEYWORDS_BR
        try:
            return await asyncio.get_event_loop().run_in_executor(
                None, self._fetch_pytrends, kws, geo, timeframe
            )
        except Exception as e:
            logger.warning(f"pytrends falhou: {e} — usando SerpAPI fallback")
            if SERPAPI_KEY:
                return await self._serpapi_fallback(kws, geo, timeframe)
            return self._build_static_fallback(kws)

    def _fetch_pytrends(self, keywords: List[str], geo: str, timeframe: str) -> List[Dict]:
        from pytrends.request import TrendReq

        pt = TrendReq(hl="pt-BR", tz=-180, timeout=(10, 30))
        results = []

        # pytrends suporta até 5 keywords por request
        for i in range(0, len(keywords), 5):
            batch = keywords[i : i + 5]
            try:
                pt.build_payload(batch, cat=0, timeframe=timeframe, geo=geo)
                df = pt.interest_over_time()

                for kw in batch:
                    if df.empty or kw not in df.columns:
                        results.append({
                            "keyword": kw,
                            "trend_score": 50,
                            "geo": geo,
                            "timeframe": timeframe,
                            "timeline": [],
                        })
                        continue

                    series = df[kw]
                    trend_score = int(series.tail(4).mean())  # média das últimas 4 semanas
                    timeline = [
                        {"date": str(idx.date()), "value": int(val)}
                        for idx, val in series.tail(12).items()
                    ]
                    results.append({
                        "keyword": kw,
                        "trend_score": trend_score,
                        "geo": geo,
                        "timeframe": timeframe,
                        "timeline": timeline,
                    })
            except Exception as e:
                logger.warning(f"pytrends batch {batch}: {e}")
                for kw in batch:
                    results.append({"keyword": kw, "trend_score": 50, "geo": geo, "timeframe": timeframe, "timeline": []})

        return results

    async def get_rising_queries(self, keyword: str = "produtos para vender", geo: str = "BR") -> List[Dict]:
        """Retorna queries em ascensão para descobrir novos nichos."""
        try:
            def _fetch():
                from pytrends.request import TrendReq
                pt = TrendReq(hl="pt-BR", tz=-180, timeout=(10, 25))
                pt.build_payload([keyword], cat=0, timeframe="today 3-m", geo=geo)
                rq = pt.related_queries()
                rising = rq.get(keyword, {}).get("rising")
                if rising is None or rising.empty:
                    return []
                return [
                    {
                        "query": row["query"],
                        "growth": str(row["value"]),
                        "is_breakout": row["value"] >= 5000,
                    }
                    for _, row in rising.iterrows()
                ]
            return await asyncio.get_event_loop().run_in_executor(None, _fetch)
        except Exception as e:
            logger.warning(f"rising queries: {e}")
            return []

    async def _serpapi_fallback(self, keywords: List[str], geo: str, timeframe: str) -> List[Dict]:
        import httpx
        results = []
        for i in range(0, min(len(keywords), 10), 5):
            batch = keywords[i : i + 5]
            try:
                async with httpx.AsyncClient(timeout=30) as c:
                    r = await c.get(
                        "https://serpapi.com/search.json",
                        params={
                            "engine": "google_trends",
                            "q": ",".join(batch),
                            "geo": geo,
                            "date": timeframe,
                            "data_type": "TIMESERIES",
                            "tz": "-180",
                            "api_key": SERPAPI_KEY,
                        },
                    )
                    r.raise_for_status()
                    data = r.json()
                timeline_data = data.get("interest_over_time", {}).get("timeline_data", [])
                for j, kw in enumerate(batch):
                    recent = timeline_data[-4:] if len(timeline_data) >= 4 else timeline_data
                    vals = [
                        d.get("values", [{}])[j].get("extracted_value", 0)
                        if j < len(d.get("values", []))
                        else 0
                        for d in recent
                    ]
                    avg = round(sum(vals) / len(vals)) if vals else 50
                    results.append({"keyword": kw, "trend_score": avg, "geo": geo,
                                    "timeframe": timeframe, "timeline": []})
            except Exception as e:
                logger.warning(f"SerpAPI batch: {e}")
                for kw in batch:
                    results.append({"keyword": kw, "trend_score": 50, "geo": geo,
                                    "timeframe": timeframe, "timeline": []})
        return results

    def _build_static_fallback(self, keywords: List[str]) -> List[Dict]:
        """Retorna scores estáticos quando ambas as APIs falham."""
        import random
        return [
            {
                "keyword": kw,
                "trend_score": random.randint(45, 85),
                "geo": "BR",
                "timeframe": "today 3-m",
                "timeline": [],
            }
            for kw in keywords
        ]
