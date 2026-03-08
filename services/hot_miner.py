"""
Hot Miner v2 — AliExpress True API (RapidAPI)
Fetches products from 7 priority niches scored by champion criteria.

Available API signals:
  - target_sale_price       : USD price
  - discount                : % off (trend/momentum)
  - hot_product_commission  : % commission = how hard AliExpress promotes it
  - evaluate_rate           : % rating (when returned)
  - product_main_image_url  : product image

Filters:  price ≤ $15 USD, score ≥ 50/100
Score:    commission (35) + price opportunity (25) + discount/trend (20) + niche (10) + rating (10)
"""
import asyncio, logging, os, uuid, json
import httpx

logger = logging.getLogger(__name__)

RAPIDAPI_KEY  = os.getenv("RAPIDAPI_KEY", "bfa0201ad4msh4eb2fb783613e2fp1f18b7jsn0379d6db7632")
RAPIDAPI_HOST = "aliexpress-true-api.p.rapidapi.com"
GEMINI_KEY    = os.getenv("GOOGLE_API_KEY", "")
BASE_URL      = f"https://{RAPIDAPI_HOST}/api/v3/hot-products-download"

HEADERS = {
    "x-rapidapi-host": RAPIDAPI_HOST,
    "x-rapidapi-key":  RAPIDAPI_KEY,
}

# Priority niches ordered by Brazilian market potential
CATEGORIES = [
    (66,     "Saúde e Beleza"),    # Beauty & Health
    (7294,   "Saúde e Beleza"),    # Health Appliances
    (13,     "Casa Inteligente"),  # Home & Garden
    (1503,   "Casa Inteligente"),  # Home Improvement
    (15,     "Pet"),               # Pets & Pet Supplies
    (18,     "Fitness em Casa"),   # Sports & Entertainment
    (1501,   "Bebês e Crianças"), # Mother & Kids
    (44,     "Eletrônicos"),       # Consumer Electronics
    (4,      "Cozinha"),           # Kitchen, Dining & Bar
]

PER_CATEGORY = 20
FREIGHT_BRL  = 25.0
TAX_RATE     = 0.20
MAX_COST_USD = 15.0
MIN_SCORE    = 50   # realistic threshold given API data

_NICHE_BONUS = {
    "Saúde e Beleza":   10,
    "Casa Inteligente": 9,
    "Pet":              8,
    "Fitness em Casa":  8,
    "Bebês e Crianças": 7,
    "Eletrônicos":      6,
    "Cozinha":          6,
}


def _score(commission: float, price_usd: float, discount: float, rating: float, category: str) -> int:
    """
    Score 0-100 using available API fields:
    C1 — Commission rate (35 pts): % AliExpress pays affiliates = promotion intensity
    C2 — BR Price opportunity (25 pts): cheaper = more accessible Brazilian market
    C3 — Discount/momentum (20 pts): discount = active promotion / trending
    C4 — Niche priority (10 pts): based on Brazilian market potential
    C5 — Rating (10 pts): evaluate_rate when available
    """
    # C1 — Commission (35 pts)
    if commission >= 20:
        comm_pts = 35
    elif commission >= 15:
        comm_pts = 28
    elif commission >= 10:
        comm_pts = 20
    elif commission >= 8:
        comm_pts = 14
    elif commission >= 5:
        comm_pts = 8
    else:
        comm_pts = 3

    # C2 — Price opportunity for BR market (25 pts)
    if price_usd <= 3:
        opp_pts = 25
    elif price_usd <= 6:
        opp_pts = 20
    elif price_usd <= 10:
        opp_pts = 14
    elif price_usd <= 15:
        opp_pts = 8
    else:
        opp_pts = 0

    # C3 — Discount / trend signal (20 pts)
    if discount >= 40:
        trend_pts = 20
    elif discount >= 25:
        trend_pts = 15
    elif discount >= 15:
        trend_pts = 10
    elif discount >= 5:
        trend_pts = 5
    else:
        trend_pts = 2

    # C4 — Niche priority (10 pts)
    niche_pts = _NICHE_BONUS.get(category, 5)

    # C5 — Rating (10 pts)
    if rating >= 95:
        rat_pts = 10
    elif rating >= 90:
        rat_pts = 7
    elif rating >= 80:
        rat_pts = 4
    elif rating > 0:
        rat_pts = 2
    else:
        rat_pts = 3   # unknown = neutral

    total = comm_pts + opp_pts + trend_pts + niche_pts + rat_pts
    return min(100, max(0, total))


def _dynamic_markup(price_usd: float) -> float:
    """Higher markup for cheaper products — more BR market headroom."""
    if price_usd <= 3:
        return 6.0
    elif price_usd <= 5:
        return 5.0
    elif price_usd <= 8:
        return 4.5
    elif price_usd <= 12:
        return 4.0
    return 3.5


async def _fetch_category(client: httpx.AsyncClient, category_id: int, category_name: str) -> list:
    params = {
        "category_id":     category_id,
        "page_no":         1,
        "page_size":       PER_CATEGORY,
        "target_currency": "USD",
        "target_language": "EN",
        "country":         "TH",
    }
    try:
        r = await client.get(BASE_URL, headers=HEADERS, params=params, timeout=25)
        r.raise_for_status()
        data = r.json()
        if "message" in data:
            logger.error(f"  [{category_name}] API error: {data['message']}")
            return []
        products = data.get("products", {}).get("product", [])
        logger.info(f"  [{category_name}] {len(products)} produtos retornados")
        return products
    except Exception as e:
        logger.error(f"  [{category_name}] Falhou: {type(e).__name__}: {e}")
        return []


def _map_product(raw: dict, category_name: str, usd_brl: float) -> dict | None:
    """Map AliExpress True API → NEXO schema. Returns None if filtered out."""
    product_id = str(raw.get("product_id", ""))
    title      = raw.get("product_title", "Produto")

    # Price — use target_sale_price (USD) preferring smallest value
    price_usd = float(raw.get("target_sale_price", 0) or raw.get("app_sale_price", 0) or 0)
    if price_usd <= 0 or price_usd > MAX_COST_USD:
        return None

    # Discount
    discount_str = raw.get("discount", "0%").replace("%", "")
    try:
        discount_pct = float(discount_str)
    except Exception:
        discount_pct = 0.0

    # Commission rate — primary signal
    try:
        commission = float(raw.get("hot_product_commission_rate", 0) or raw.get("commission_rate", 0) or 0)
    except Exception:
        commission = 0.0

    # Rating
    rating_str = str(raw.get("evaluate_rate", "0") or "0").replace("%", "").strip()
    try:
        rating = float(rating_str)
    except Exception:
        rating = 0.0

    # Original price for reference
    original_usd = float(raw.get("target_original_price", price_usd) or price_usd)

    # Images — main first, then extras (all from ae-pic-a1.aliexpress-media.com)
    main_img   = raw.get("product_main_image_url", "")
    small_imgs = raw.get("product_small_image_urls", {})
    extra_imgs = small_imgs.get("product_small_image_url", []) if isinstance(small_imgs, dict) else []
    all_images = [main_img] + [i for i in extra_imgs if i and i != main_img]
    all_images = [i for i in all_images if i]

    # BRL pricing
    markup         = _dynamic_markup(price_usd)
    cost_brl       = round(price_usd * usd_brl, 2)
    tax_brl        = round(cost_brl * TAX_RATE, 2)
    total_cost_brl = round(cost_brl + FREIGHT_BRL + tax_brl, 2)
    suggested_sell = round(total_cost_brl * markup, 2)
    margin_pct     = round(((suggested_sell - total_cost_brl) / suggested_sell) * 100, 1)

    # Score
    score = _score(commission, price_usd, discount_pct, rating, category_name)
    if score < MIN_SCORE:
        return None

    # Derived fields
    growth    = f"+{min(999, int(commission * 10))}%"
    opp       = min(100, int(commission * 3 + discount_pct + (100 - price_usd * 5)))
    kws       = " ".join(title.split()[:5])
    fb_ads_url = f"https://www.facebook.com/ads/library/?q={kws.replace(' ','%20')}&search_type=keyword_unordered&media_type=all&active_status=all&countries[0]=BR"

    return {
        "product_id":          product_id or str(uuid.uuid4()),
        "title":               title,
        "title_en":            title,
        "platform":            "aliexpress",
        "price_usd":           price_usd,
        "original_price_usd":  original_usd,
        "discount_pct":        discount_pct,
        "cost_brl":            cost_brl,
        "freight_brl":         FREIGHT_BRL,
        "tax_brl":             tax_brl,
        "total_cost_brl":      total_cost_brl,
        "suggested_sell_price": suggested_sell,
        "markup":              markup,
        "margin_pct":          margin_pct,
        "orders_count":        int(raw.get("lastest_volume") or 0),
        "rating":              rating,
        "evaluate_rate":       rating,
        "commission_rate":     commission,
        "category":            category_name,
        "images":              all_images,
        "product_url":         raw.get("promotion_link") or raw.get("product_detail_url", ""),
        "product_detail_url":  raw.get("product_detail_url", ""),
        "promotion_link":      raw.get("promotion_link", ""),
        "fb_ads_url":          fb_ads_url,
        "shop_name":           raw.get("shop_name", ""),
        "shop_url":            raw.get("shop_url", ""),
        "video_url":           raw.get("product_video_url", ""),
        "score":               score,
        "opportunity":         opp,
        "is_hot":              commission >= 15 or discount_pct >= 30,
        "is_viral":            commission >= 20 or discount_pct >= 40,
        "is_new":              True,
        "growth":              growth,
        "br_status":           "Não Vendido",
        "sources":             [{"name": "AliExpress", "url": raw.get("product_detail_url", ""), "price": f"${price_usd:.2f}"}],
        "tags":                [category_name, raw.get("second_level_category_name", "")],
    }


async def _translate_one_mymemory(client: httpx.AsyncClient, text: str) -> str:
    """Translate a single title via MyMemory free API (no key needed)."""
    try:
        short = " ".join(text.split()[:10])  # cap at 10 words
        r = await client.get(
            "https://api.mymemory.translated.net/get",
            params={"q": short, "langpair": "en|pt-BR"},
            timeout=10
        )
        d  = r.json()
        tr = d.get("responseData", {}).get("translatedText", "")
        if tr and "MYMEMORY WARNING" not in tr:
            return tr
    except Exception:
        pass
    return text


async def _translate_titles(products: list) -> list:
    """Translate titles: tries Gemini first (batch), falls back to MyMemory (sequential)."""
    if not products:
        return products

    # Try Gemini batch translation
    if GEMINI_KEY:
        try:
            import google.generativeai as genai
            genai.configure(api_key=GEMINI_KEY)
            model  = genai.GenerativeModel("gemini-2.0-flash-lite")
            titles = [p["title_en"] for p in products]
            prompt = (
                "Você é especialista em nomes de produtos para marketplaces brasileiros.\n"
                "Traduza cada título para português brasileiro NATURAL e ATRAENTE (máx 80 chars).\n"
                "Não traduza siglas (USB, LED, WiFi). Retorne APENAS os títulos, um por linha.\n\n"
                + "\n".join(f"{i+1}. {t}" for i, t in enumerate(titles))
            )
            resp   = await asyncio.to_thread(model.generate_content, prompt)
            lines  = [l.strip() for l in resp.text.strip().split("\n") if l.strip()]
            cleaned = []
            for l in lines:
                if l and len(l) > 2 and l[0].isdigit() and l[1] in ".):":
                    l = l.split(None, 1)[1] if " " in l else l
                cleaned.append(l)
            if len(cleaned) == len(products):
                for p, pt in zip(products, cleaned):
                    p["title"] = pt
                logger.info(f"Títulos traduzidos via Gemini: {len(cleaned)}")
                return products
        except Exception as e:
            logger.warning(f"Gemini falhou ({e}) — usando MyMemory")

    # Fallback: MyMemory free API (sequential, ~120ms/req)
    logger.info(f"Traduzindo {len(products)} títulos via MyMemory...")
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for p in products:
            pt = await _translate_one_mymemory(client, p["title_en"])
            if pt != p["title_en"]:
                p["title"] = pt
            await asyncio.sleep(0.12)
    logger.info("Tradução MyMemory concluída")
    return products


async def fetch_hot_products(usd_brl: float = 6.10, limit: int = 50) -> list:
    """Fetch HOT products across all priority niches with scoring filters applied."""
    logger.info(f"Hot Miner v2: {len(CATEGORIES)} nichos, filtros: ≤${MAX_COST_USD}, score≥{MIN_SCORE}")
    results = []

    async with httpx.AsyncClient(follow_redirects=True) as client:
        tasks       = [_fetch_category(client, cid, cname) for cid, cname in CATEGORIES]
        all_batches = await asyncio.gather(*tasks)

    passed = failed = 0
    for (cid, cname), batch in zip(CATEGORIES, all_batches):
        for raw in batch:
            try:
                mapped = _map_product(raw, cname, usd_brl)
                if mapped:
                    results.append(mapped)
                    passed += 1
                else:
                    failed += 1
            except Exception as e:
                logger.warning(f"Erro ao mapear {raw.get('product_id')}: {e}")
                failed += 1

    logger.info(f"Hot Miner: {passed} aprovados, {failed} rejeitados")

    # Deduplicate, sort by score
    seen, unique = set(), []
    for p in sorted(results, key=lambda x: x["score"], reverse=True):
        if p["product_id"] not in seen:
            seen.add(p["product_id"])
            unique.append(p)

    top = unique[:limit]

    # Translate titles to Portuguese
    top = await _translate_titles(top)

    logger.info(f"Hot Miner: {len(top)} produtos prontos para importar")
    return top
