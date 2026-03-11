"""
AliExpress Direct Scraper (sem Apify)
Usa httpx com headers de browser real para buscar produtos.
Se APIFY_TOKEN existir, usa Apify. Caso contrário, scraping direto.
"""
import httpx, os, json, logging, re
from typing import List, Dict

logger = logging.getLogger(__name__)
APIFY_TOKEN = os.getenv("APIFY_TOKEN", "")


class AliExpressDirectScraper:
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://www.aliexpress.com/",
        "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
    }

    async def search_products(self, keywords: List[str], max_results=20) -> List[Dict]:
        if APIFY_TOKEN:
            return await self._apify_search(keywords, max_results)
        all_p = []
        for kw in keywords:
            try:
                items = await self._direct_search(kw, max_results)
                all_p.extend(items)
            except Exception as e:
                logger.error(f"AliExpress direto '{kw}': {e}")
        return self._dedup(all_p)

    async def _apify_search(self, keywords: List[str], max_results: int) -> List[Dict]:
        url = f"https://api.apify.com/v2/acts/epctex~aliexpress-scraper/run-sync-get-dataset-items?token={APIFY_TOKEN}&timeout=300&memory=1024"
        all_p = []
        for kw in keywords:
            try:
                async with httpx.AsyncClient(timeout=360) as c:
                    r = await c.post(url, json={"searchTerms": [kw], "maxItems": max_results, "shipTo": "BR", "currency": "USD", "proxyConfiguration": {"useApifyProxy": True}})
                    r.raise_for_status()
                    items = r.json()
                all_p.extend([self._norm(i) for i in items if self._valid(i)])
            except Exception as e:
                logger.error(f"Apify '{kw}': {e}")
        return self._dedup(all_p)

    async def _direct_search(self, keyword: str, max_results: int) -> List[Dict]:
        """Scraping direto via httpx."""
        url = f"https://www.aliexpress.com/wholesale?SearchText={keyword.replace(' ', '+')}&shipCountry=BR&currency=USD"
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=self.HEADERS) as c:
                r = await c.get(url)
                if r.status_code != 200:
                    return []
                html = r.text
            return self._parse_html(html, max_results)
        except Exception as e:
            logger.warning(f"Scraping direto falhou ({e}), usando dados mock para '{keyword}'")
            return []

    def _parse_html(self, html: str, max_results: int) -> List[Dict]:
        """Extrai produtos do HTML do AliExpress."""
        results = []
        # Tenta extrair JSON embutido na página
        pattern = r'window\._dida_config_\s*=\s*(\{.*?\});'
        match = re.search(pattern, html, re.DOTALL)
        if not match:
            # Tenta padrão alternativo
            pattern2 = r'"mods":\{"itemList":\{"content":(\[.*?\])'
            match = re.search(pattern2, html, re.DOTALL)
            if match:
                try:
                    items = json.loads(match.group(1))
                    for item in items[:max_results]:
                        parsed = self._parse_item(item)
                        if parsed:
                            results.append(parsed)
                except Exception:
                    pass
        return results

    def _parse_item(self, item: dict) -> Dict:
        try:
            pid = str(item.get("productId", item.get("itemId", "")))
            title = item.get("title", {})
            if isinstance(title, dict):
                title = title.get("displayTitle", title.get("seoTitle", ""))
            price = item.get("prices", {}).get("salePrice", {})
            if isinstance(price, dict):
                price_usd = float(price.get("minPrice", price.get("value", 0)))
            else:
                price_usd = float(price or 0)
            img = item.get("image", {})
            if isinstance(img, dict):
                img_url = "https:" + img.get("imgUrl", "").lstrip(":")
            else:
                img_url = str(img or "")
            orders = item.get("trade", {}).get("realTrade", "0").replace("+", "").replace(",", "")
            orders = int(re.sub(r'[^0-9]', '', orders)) if orders else 0
            rating_info = item.get("evaluation", {})
            rating = float(rating_info.get("starRating", 4.5)) if isinstance(rating_info, dict) else 4.5
            return {
                "platform": "aliexpress",
                "product_id": pid,
                "title": title,
                "price_usd": price_usd,
                "images": [img_url] if img_url else [],
                "image_url": img_url,
                "rating": rating,
                "orders_count": orders,
                "product_url": f"https://www.aliexpress.com/item/{pid}.html",
                "supplier_name": "",
                "category": "Outros",
            }
        except Exception:
            return {}

    def _norm(self, i) -> Dict:
        pr = i.get("price", {}); pusd = float(pr.get("min", pr.get("value", 0)) if isinstance(pr, dict) else pr or 0)
        imgs = i.get("images", [i.get("image", "")])
        img_url = imgs[0] if imgs else ""
        return {
            "platform": "aliexpress",
            "product_id": str(i.get("id", i.get("itemId", ""))),
            "title": i.get("title", i.get("name", "Unknown")),
            "price_usd": pusd,
            "images": imgs,
            "image_url": img_url,
            "rating": float((i.get("rating", {}).get("averageStar", 0) if isinstance(i.get("rating"), dict) else i.get("averageStarRate", 0)) or 0),
            "orders_count": int(i.get("tradeCount", i.get("orders", 0)) or 0),
            "product_url": i.get("url", i.get("productUrl", "")),
            "supplier_name": i.get("storeName", ""),
            "category": i.get("categoryId", ""),
        }

    def _valid(self, i) -> bool:
        pr = i.get("price", {})
        v = pr.get("min", pr.get("value", 0)) if isinstance(pr, dict) else pr
        return bool(i.get("title") or i.get("name")) and float(v or 0) > 0

    def _dedup(self, items):
        seen, out = set(), []
        for p in items:
            k = p.get("product_id", "") or p.get("title", "")
            if k not in seen: seen.add(k); out.append(p)
        return out
