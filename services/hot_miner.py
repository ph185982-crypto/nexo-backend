"""
Hot Miner — AliExpress True API (RapidAPI)
Fetches real HOT products across categories and enriches with BRL pricing.
"""
import asyncio, logging, os, uuid
import httpx

logger = logging.getLogger(__name__)

RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "bfa0201ad4msh4eb2fb783613e2fp1f18b7jsn0379d6db7632")
RAPIDAPI_HOST = "aliexpress-true-api.p.rapidapi.com"
BASE_URL = f"https://{RAPIDAPI_HOST}/api/v3/hot-products-download"

HEADERS = {
    "x-rapidapi-host": RAPIDAPI_HOST,
    "x-rapidapi-key": RAPIDAPI_KEY,
}

# Category IDs → friendly names for the Brazilian market
CATEGORIES = [
    (1509,        "Joias & Acessórios"),
    (15,          "Pet"),
    (6,           "Eletrodomésticos"),
    (1524,        "Bolsas"),
    (200000783,   "Moda Masculina"),
    (200000345,   "Moda Feminina"),
    (18,          "Esporte"),
]

# How many products to pull per category (total ≈ 50)
PER_CATEGORY = 8


async def _fetch_category(client: httpx.AsyncClient, category_id: int, category_name: str) -> list:
    params = {
        "category_id": category_id,
        "page_no": 1,
        "page_size": PER_CATEGORY,
        "target_currency": "USD",
        "target_language": "EN",
        "country": "BR",
    }
    try:
        r = await client.get(BASE_URL, headers=HEADERS, params=params, timeout=20)
        r.raise_for_status()
        data = r.json()
        products = data.get("products", {}).get("product", [])
        logger.info(f"  [{category_name}] {len(products)} produtos retornados")
        return products
    except Exception as e:
        logger.error(f"  [{category_name}] Falhou: {e}")
        return []


def _map_product(raw: dict, category_name: str, usd_brl: float) -> dict:
    """Map AliExpress True API fields → NEXO DB schema."""
    product_id = str(raw.get("product_id", ""))
    title = raw.get("product_title", "Produto")
    price_usd = float(raw.get("target_sale_price", 0) or raw.get("app_sale_price", 0) or 0)
    original_usd = float(raw.get("target_original_price", price_usd) or price_usd)
    discount_str = raw.get("discount", "0%").replace("%", "")
    try:
        discount_pct = float(discount_str)
    except Exception:
        discount_pct = 0

    # Sales volume (latest_volume or lastest_volume typo in API)
    volume = int(raw.get("lastest_volume") or raw.get("latest_volume") or 0)

    # Rating: API gives "90.0%" → convert to 4.5 scale or keep as 0-100
    rating_str = str(raw.get("evaluate_rate", "0%")).replace("%", "")
    try:
        rating = float(rating_str)
    except Exception:
        rating = 0.0

    # Images
    main_img = raw.get("product_main_image_url", "")
    small_imgs = raw.get("product_small_image_urls", {})
    if isinstance(small_imgs, dict):
        extra_imgs = small_imgs.get("product_small_image_url", [])
    else:
        extra_imgs = []
    all_images = [main_img] + [i for i in extra_imgs if i != main_img]
    all_images = [i for i in all_images if i]

    # BRL pricing
    freight_brl = 35.0
    tax_rate = 0.20
    cost_brl = round(price_usd * usd_brl, 2)
    tax_brl = round(cost_brl * tax_rate, 2)
    total_cost_brl = round(cost_brl + freight_brl + tax_brl, 2)
    markup = 3.0
    suggested_sell = round(total_cost_brl * markup, 2)
    margin_pct = round(((suggested_sell - total_cost_brl) / suggested_sell) * 100, 1)

    # Opportunity & score heuristic
    opp = min(100, int(
        (volume / max(price_usd, 1)) * (markup / 3) / 100 +
        (discount_pct / 2) +
        (rating / 10)
    ))
    score = min(100, int(
        (rating * 0.4) +
        (min(volume, 50000) / 50000 * 40) +
        (discount_pct * 0.2) + 10
    ))

    # Growth tag
    growth = f"+{min(999, volume // 1000)}%" if volume > 0 else "+0%"

    # Facebook Ads Library search URL from title keywords
    kws = " ".join(title.split()[:5])
    fb_ads_url = f"https://www.facebook.com/ads/library/?q={kws.replace(' ', '%20')}&search_type=keyword_unordered&media_type=all&active_status=all&countries[0]=BR"

    return {
        "product_id": product_id or str(uuid.uuid4()),
        "title": title,
        "platform": "aliexpress",
        "price_usd": price_usd,
        "original_price_usd": original_usd,
        "discount_pct": discount_pct,
        "cost_brl": cost_brl,
        "freight_brl": freight_brl,
        "tax_brl": tax_brl,
        "total_cost_brl": total_cost_brl,
        "suggested_sell_price": suggested_sell,
        "markup": markup,
        "margin_pct": margin_pct,
        "orders_count": volume,
        "rating": rating,
        "evaluate_rate": rating,
        "category": category_name,
        "second_level_category": raw.get("second_level_category_name", ""),
        "images": all_images,
        "product_url": raw.get("promotion_link") or raw.get("product_detail_url", ""),
        "product_detail_url": raw.get("product_detail_url", ""),
        "promotion_link": raw.get("promotion_link", ""),
        "fb_ads_url": fb_ads_url,
        "shop_name": raw.get("shop_name", ""),
        "shop_url": raw.get("shop_url", ""),
        "video_url": raw.get("product_video_url", ""),
        "commission_rate": float(raw.get("hot_product_commission_rate", 0) or 0),
        "score": score,
        "opportunity": opp,
        "is_hot": discount_pct >= 15 or volume >= 1000,
        "is_viral": volume >= 5000 or discount_pct >= 30,
        "is_new": True,
        "growth": growth,
        "br_status": "Não Vendido",
        "source": "aliexpress_true_api",
    }


async def fetch_hot_products(usd_brl: float = 6.10, limit: int = 50) -> list:
    """Fetch HOT products across all configured categories."""
    logger.info(f"Hot Miner: buscando produtos em {len(CATEGORIES)} categorias (USD/BRL={usd_brl:.2f})")
    results = []

    async with httpx.AsyncClient(follow_redirects=True) as client:
        tasks = [_fetch_category(client, cid, cname) for cid, cname in CATEGORIES]
        all_batches = await asyncio.gather(*tasks)

    for (cid, cname), batch in zip(CATEGORIES, all_batches):
        for raw in batch:
            try:
                mapped = _map_product(raw, cname, usd_brl)
                results.append(mapped)
            except Exception as e:
                logger.warning(f"Erro ao mapear produto {raw.get('product_id')}: {e}")

    # Sort by score descending, deduplicate by product_id
    seen = set()
    unique = []
    for p in sorted(results, key=lambda x: x["score"], reverse=True):
        if p["product_id"] not in seen:
            seen.add(p["product_id"])
            unique.append(p)

    logger.info(f"Hot Miner: {len(unique)} produtos únicos coletados")
    return unique[:limit]
