"""
AliExpress DS Center Scraper — API pública + RapidAPI fallback
Busca produtos bestsellers reais com imagens, preços e vendas.
"""
import httpx, os, logging, asyncio, re
from typing import List, Dict

logger = logging.getLogger(__name__)

RAPIDAPI_KEY  = os.getenv("RAPIDAPI_KEY", "")
DS_CENTER_URL = "https://www.aliexpress.com/dropshipping-center/api/searchTopSellingProduct.do"
GLSEARCH_URL  = "https://www.aliexpress.com/glosearch/api/product"

HEADERS_ALI = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.aliexpress.com/",
    "Origin": "https://www.aliexpress.com",
}

BESTSELLER_CATEGORIES = [
    {"name": "Phone Accessories",   "catId": "509"},
    {"name": "Consumer Electronics","catId": "44"},
    {"name": "Home & Garden",       "catId": "13"},
    {"name": "Beauty & Health",     "catId": "66"},
    {"name": "Sports & Outdoors",   "catId": "18"},
    {"name": "Toys & Hobbies",      "catId": "26"},
    {"name": "Clothing",            "catId": "3"},
    {"name": "Bags & Luggage",      "catId": "9"},
]

TRENDING_KEYWORDS = [
    "mini projector 1080p", "hair dryer brush", "massage gun mini",
    "wireless charger magnetic", "ring light led", "portable blender usb",
    "nail lamp uv gel", "hair removal ipl", "neck massager electric",
    "smart watch fitness", "bluetooth earbuds tws", "camera security wifi",
    "kitchen gadget tools", "face roller jade", "body slimmer device",
    "dog pet accessories", "car phone holder", "led strip lights",
    "desk organizer", "travel bag waterproof",
]


class AliExpressDSScraper:
    """Busca bestsellers no AliExpress DS Center (gratuito) e via RapidAPI."""

    async def get_weekly_bestsellers(self, min_sales=500, limit=50) -> List[Dict]:
        """Busca na seção Weekly Bestsellers do DS Center."""
        all_products = []

        # Tenta DS Center direto
        for cat in BESTSELLER_CATEGORIES[:4]:
            try:
                items = await self._ds_center_search(cat["catId"], limit=20)
                filtered = [p for p in items if p.get("orders_count", 0) >= min_sales and p.get("rating", 0) >= 4.5]
                all_products.extend(filtered)
                logger.info(f"DS Center '{cat['name']}': {len(filtered)} produtos")
            except Exception as e:
                logger.warning(f"DS Center falhou para {cat['name']}: {e}")

        # Fallback: busca por keywords via glosearch
        if len(all_products) < 20:
            for kw in TRENDING_KEYWORDS[:10]:
                try:
                    items = await self._glosearch(kw, limit=10)
                    filtered = [p for p in items if p.get("orders_count", 0) >= min_sales]
                    all_products.extend(filtered)
                except Exception as e:
                    logger.warning(f"Glosearch '{kw}': {e}")
                if len(all_products) >= limit:
                    break

        # Fallback RapidAPI se configurado
        if len(all_products) < 20 and RAPIDAPI_KEY:
            for kw in TRENDING_KEYWORDS[:5]:
                try:
                    items = await self._rapidapi_search(kw, limit=15)
                    all_products.extend(items)
                except Exception as e:
                    logger.warning(f"RapidAPI '{kw}': {e}")

        deduped = self._dedup(all_products)
        deduped.sort(key=lambda x: x.get("orders_count", 0), reverse=True)
        return deduped[:limit]

    async def _ds_center_search(self, cat_id: str, limit=20) -> List[Dict]:
        params = {
            "lang": "en_US", "page": 1, "pageSize": limit,
            "catId": cat_id, "sortValue": "SALE_DESC",
            "minTradeCount": 500,
        }
        async with httpx.AsyncClient(timeout=20, headers=HEADERS_ALI) as c:
            r = await c.get(DS_CENTER_URL, params=params)
            r.raise_for_status()
            data = r.json()

        items = data.get("result", {}).get("resultList", []) or data.get("resultList", []) or []
        return [self._norm_ds(i) for i in items if self._valid(i)]

    async def _glosearch(self, keyword: str, limit=10) -> List[Dict]:
        params = {
            "keywords": keyword, "isNew": "n", "sort": "SALE_PRICE_ASC",
            "page": 1, "pageSize": limit, "currency": "USD",
        }
        async with httpx.AsyncClient(timeout=15, headers=HEADERS_ALI) as c:
            r = await c.get(GLSEARCH_URL, params=params)
            r.raise_for_status()
            data = r.json()

        items = data.get("mods", {}).get("itemList", {}).get("content", []) or []
        return [self._norm_glo(i) for i in items if i.get("title")]

    async def _rapidapi_search(self, keyword: str, limit=15) -> List[Dict]:
        url = "https://aliexpress-datahub.p.rapidapi.com/item_search"
        headers = {
            "X-RapidAPI-Key": RAPIDAPI_KEY,
            "X-RapidAPI-Host": "aliexpress-datahub.p.rapidapi.com",
        }
        params = {"q": keyword, "page": "1", "sort": "SALE_PRICE_ASC", "locale": "en_US"}
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.get(url, headers=headers, params=params)
            r.raise_for_status()
            data = r.json()
        items = data.get("result", {}).get("resultList", []) or []
        return [self._norm_rapid(i) for i in items[:limit]]

    def _norm_ds(self, i: Dict) -> Dict:
        product = i.get("product", i)
        images = product.get("imageUrls", [product.get("imageUrl", "")])
        if isinstance(images, str): images = [images]
        images = [img for img in images if img]
        price = float(product.get("salePrice", {}).get("usdPrice", 0) or product.get("usdSalePrice", 0) or 0)
        sales = int(product.get("monthTradeCount", product.get("tradeCount", 0)) or 0)
        return {
            "platform": "aliexpress",
            "product_id": str(product.get("productId", product.get("id", ""))),
            "title": product.get("subject", product.get("title", ""))[:200],
            "price_usd": price,
            "images": images,
            "video_url": product.get("videoUrl", ""),
            "rating": float(product.get("evaluationStar", product.get("starRating", 4.5)) or 4.5),
            "orders_count": sales,
            "product_url": f"https://www.aliexpress.com/item/{product.get('productId','')}.html",
            "supplier_name": product.get("storeName", ""),
            "category": product.get("categoryName", "Outros"),
            "is_hot": sales >= 5000,
        }

    def _norm_glo(self, i: Dict) -> Dict:
        prices = i.get("prices", {})
        sale = prices.get("salePrice", {})
        price = float(sale.get("minPrice", sale.get("value", 0)) or 0)
        images = i.get("imageUrl", "")
        if images and not images.startswith("http"): images = "https:" + images
        sales = int(i.get("tradeDesc", "0").replace(",", "").split()[0] if i.get("tradeDesc") else 0)
        return {
            "platform": "aliexpress",
            "product_id": str(i.get("productId", i.get("itemId", ""))),
            "title": i.get("title", {}).get("displayTitle", i.get("title", ""))[:200] if isinstance(i.get("title"), dict) else str(i.get("title",""))[:200],
            "price_usd": price,
            "images": [images] if images else [],
            "video_url": "",
            "rating": float(i.get("averageStarRate", 4.5) or 4.5),
            "orders_count": sales,
            "product_url": f"https://www.aliexpress.com/item/{i.get('productId','')}.html",
            "supplier_name": i.get("store", {}).get("storeName", "") if isinstance(i.get("store"), dict) else "",
            "category": "Outros",
            "is_hot": sales >= 5000,
        }

    def _norm_rapid(self, i: Dict) -> Dict:
        product = i.get("item", i)
        price = float(product.get("sku", {}).get("def", {}).get("price", 0) or 0)
        images = [product.get("image", {}).get("imgUrl", "")] if isinstance(product.get("image"), dict) else []
        images = ["https:" + img if img and not img.startswith("http") else img for img in images if img]
        return {
            "platform": "aliexpress",
            "product_id": str(product.get("itemId", "")),
            "title": product.get("title", "")[:200],
            "price_usd": price,
            "images": images,
            "video_url": "",
            "rating": float(product.get("averageStarRate", 4.5) or 4.5),
            "orders_count": int(product.get("trade", {}).get("tradeCount", 0) or 0),
            "product_url": f"https://www.aliexpress.com/item/{product.get('itemId','')}.html",
            "supplier_name": "",
            "category": "Outros",
            "is_hot": False,
        }

    def _valid(self, i: Dict) -> bool:
        p = i.get("product", i)
        return bool(p.get("subject") or p.get("title") or p.get("productId"))

    def _dedup(self, items: List[Dict]) -> List[Dict]:
        seen, out = set(), []
        for p in items:
            k = p.get("product_id") or p.get("title", "")
            if k and k not in seen:
                seen.add(k); out.append(p)
        return out
