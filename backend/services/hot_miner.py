"""
Hot Miner v3 — AliExpress True API + Mercado Livre Saturation Check
Nichos prioritários: Saúde/Beleza, Casa, Pet, Fitness, Bebês, Eletrônicos, Cozinha
Score mínimo 75/100 baseado nos critérios de produto campeão.
Títulos traduzidos para PT-BR via Gemini 2.0 Flash (MyMemory como fallback).
"""
import asyncio, logging, os, uuid
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

# Nichos prioritários com keywords para busca ML e categoria IDs
CATEGORIES = [
    (66,    "Saúde e Beleza",   "massageador skincare escova"),
    (7294,  "Saúde e Beleza",   "led facial cuidados pele"),
    (13,    "Casa Inteligente", "organizador gadget cozinha"),
    (1503,  "Casa Inteligente", "limpeza casa inteligente"),
    (15,    "Pet",              "brinquedo gato cama pet"),
    (18,    "Fitness em Casa",  "elastico musculacao tapete yoga"),
    (1501,  "Bebês e Crianças", "monitor bebe mordedor educativo"),
    (44,    "Eletrônicos",      "carregador magnetico suporte celular"),
    (4,     "Cozinha",          "cortador legumes forma silicone"),
]

PER_CATEGORY  = 20
FREIGHT_BRL   = 25.0
TAX_RATE      = 0.20
MAX_COST_USD  = 15.0
MIN_SCORE     = 75

_NICHE_BONUS = {
    "Saúde e Beleza":   10,
    "Casa Inteligente": 9,
    "Pet":              8,
    "Fitness em Casa":  8,
    "Bebês e Crianças": 7,
    "Eletrônicos":      6,
    "Cozinha":          6,
}


def _dynamic_markup(price_usd: float) -> float:
    if price_usd <= 3:  return 6.0
    if price_usd <= 5:  return 5.5
    if price_usd <= 8:  return 5.0
    if price_usd <= 12: return 4.0
    return 3.5


def _compute_score(markup: float, br_status: str, commission: float,
                   rating: float, discount: float, category: str) -> int:
    """
    Score 0-100 baseado nos critérios de produto campeão:
    - Markup (30 pts)
    - Status BR via ML (25 pts)
    - Volume/comissão proxy (20 pts)
    - Avaliação (15 pts)
    - Produto novo / tendência (10 pts)
    """
    # Markup (30 pts)
    if markup > 5:
        markup_pts = 30
    elif markup >= 3.5:
        markup_pts = 20
    else:
        markup_pts = 5

    # BR Status via Mercado Livre (25 pts)
    br_pts = {"Não Vendido": 25, "Pouco Vendido": 15, "Já Vendido": 5}.get(br_status, 15)

    # Volume proxy via commission rate (20 pts)
    # Alta comissão = AliExpress promovendo muito = produto campeão global
    if commission >= 20:
        vol_pts = 20
    elif commission >= 8:
        vol_pts = 10
    elif commission >= 5:
        vol_pts = 5
    else:
        vol_pts = 0

    # Avaliação (15 pts) — evaluate_rate vem em % (94% = 4.7 estrelas, 90% = 4.5)
    if rating >= 94:
        rat_pts = 15
    elif rating >= 90:
        rat_pts = 10
    elif rating >= 80:
        rat_pts = 5
    else:
        rat_pts = 0

    # Tendência / produto novo (10 pts) — todos os produtos são is_new no scan inicial
    trend_pts = 10

    total = markup_pts + br_pts + vol_pts + rat_pts + trend_pts
    return min(100, max(0, total))


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
            logger.error(f"[{category_name}] API error: {data['message']}")
            return []
        products = data.get("products", {}).get("product", [])
        logger.info(f"[{category_name}] {len(products)} produtos retornados")
        return products
    except Exception as e:
        logger.error(f"[{category_name}] Falhou: {e}")
        return []


def _map_product(raw: dict, category_name: str, ml_keyword: str, usd_brl: float) -> dict | None:
    product_id = str(raw.get("product_id", ""))
    title      = raw.get("product_title", "Produto")

    price_usd = float(raw.get("target_sale_price", 0) or raw.get("app_sale_price", 0) or 0)
    if price_usd <= 0 or price_usd > MAX_COST_USD:
        return None

    discount_str = raw.get("discount", "0%").replace("%", "")
    try:
        discount_pct = float(discount_str)
    except Exception:
        discount_pct = 0.0

    try:
        commission = float(raw.get("hot_product_commission_rate", 0) or raw.get("commission_rate", 0) or 0)
    except Exception:
        commission = 0.0

    rating_str = str(raw.get("evaluate_rate", "0") or "0").replace("%", "").strip()
    try:
        rating = float(rating_str)
    except Exception:
        rating = 0.0

    original_usd = float(raw.get("target_original_price", price_usd) or price_usd)

    # Imagens — prioriza a URL principal de alta qualidade
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

    # Score provisório sem status ML (será atualizado depois)
    score = _compute_score(markup, "Não Vendido", commission, rating, discount_pct, category_name)
    if score < MIN_SCORE:
        return None

    opp        = min(100, int(commission * 3 + discount_pct + (100 - price_usd * 5)))
    growth     = f"+{min(999, int(commission * 10))}%"
    kws        = " ".join(title.split()[:5])
    fb_ads_url = f"https://www.facebook.com/ads/library/?q={kws.replace(' ','%20')}&search_type=keyword_unordered&media_type=all&active_status=all&countries[0]=BR"

    return {
        "product_id":           product_id or str(uuid.uuid4()),
        "title":                title,
        "title_en":             title,
        "ml_keyword":           ml_keyword,
        "platform":             "aliexpress",
        "price_usd":            price_usd,
        "original_price_usd":   original_usd,
        "discount_pct":         discount_pct,
        "cost_brl":             cost_brl,
        "freight_brl":          FREIGHT_BRL,
        "tax_brl":              tax_brl,
        "total_cost_brl":       total_cost_brl,
        "suggested_sell_price": suggested_sell,
        "markup":               markup,
        "margin_pct":           margin_pct,
        "orders_count":         int(raw.get("lastest_volume") or 0),
        "rating":               rating,
        "evaluate_rate":        rating,
        "commission_rate":      commission,
        "category":             category_name,
        "images":               all_images,
        "product_url":          raw.get("promotion_link") or raw.get("product_detail_url", ""),
        "product_detail_url":   raw.get("product_detail_url", ""),
        "promotion_link":       raw.get("promotion_link", ""),
        "fb_ads_url":           fb_ads_url,
        "shop_name":            raw.get("shop_name", ""),
        "shop_url":             raw.get("shop_url", ""),
        "video_url":            raw.get("product_video_url", ""),
        "score":                score,
        "opportunity":          opp,
        "is_hot":               commission >= 15 or discount_pct >= 30,
        "is_viral":             commission >= 20 or discount_pct >= 40,
        "is_new":               True,
        "growth":               growth,
        "br_status":            "Não Vendido",
        "sources":              [{"name": "AliExpress", "url": raw.get("product_detail_url", ""), "price": f"${price_usd:.2f}"}],
        "tags":                 [category_name, raw.get("second_level_category_name", "")],
    }


async def _enrich_with_ml(products: list) -> list:
    """Verifica saturação no Mercado Livre e atualiza score e br_status."""
    try:
        from services.ml_checker import check_ml_saturation, ml_score_bonus
    except ImportError:
        return products

    # Agrupa por keyword para economizar chamadas
    keyword_map: dict[str, list] = {}
    for p in products:
        kw = p.get("ml_keyword", p.get("category", "produto"))
        keyword_map.setdefault(kw, []).append(p)

    for kw, group in keyword_map.items():
        try:
            status, count = await check_ml_saturation(kw)
            bonus = ml_score_bonus(status)
            for p in group:
                p["br_status"] = status
                # Recalcula score com status ML real
                p["score"] = min(100, _compute_score(
                    p["markup"], status, p["commission_rate"],
                    p["rating"], p["discount_pct"], p["category"]
                ))
            logger.info(f"ML '{kw}': {count} resultados → {status} ({len(group)} produtos)")
        except Exception as e:
            logger.warning(f"ML enrich falhou para '{kw}': {e}")
        await asyncio.sleep(0.3)

    return products


async def _translate_one_mymemory(client: httpx.AsyncClient, text: str) -> str:
    """Traduz um título via MyMemory API (gratuito, sem chave)."""
    try:
        short = " ".join(text.split()[:12])
        r = await client.get(
            "https://api.mymemory.translated.net/get",
            params={"q": short, "langpair": "en|pt-BR"},
            timeout=10
        )
        d  = r.json()
        tr = d.get("responseData", {}).get("translatedText", "")
        if tr and "MYMEMORY WARNING" not in tr and len(tr) > 3:
            return tr
    except Exception:
        pass
    return text


async def _translate_titles(products: list) -> list:
    """Traduz títulos para PT-BR: tenta Gemini (batch) → MyMemory (fallback)."""
    if not products:
        return products

    # Tenta Gemini 2.0 Flash
    if GEMINI_KEY:
        try:
            import google.generativeai as genai
            genai.configure(api_key=GEMINI_KEY)
            model  = genai.GenerativeModel("gemini-2.0-flash-lite")
            titles = [p["title_en"] for p in products]
            prompt = (
                "Você é especialista em produtos para Mercado Livre e Shopee Brasil.\n"
                "Traduza cada título para português brasileiro NATURAL e COMERCIAL.\n"
                "Use nomes que vendem: ex. 'Portable Mini Projector 4K' → 'Mini Projetor Portátil 4K'\n"
                "Regras: máx 80 chars, não traduzir siglas (USB/LED/WiFi), retornar APENAS os títulos, um por linha.\n\n"
                + "\n".join(f"{i+1}. {t}" for i, t in enumerate(titles))
            )
            resp    = await asyncio.to_thread(model.generate_content, prompt)
            lines   = [l.strip() for l in resp.text.strip().split("\n") if l.strip()]
            cleaned = []
            for l in lines:
                if l and len(l) > 2 and l[0].isdigit() and l[1] in ".):":
                    l = l.split(None, 1)[1] if " " in l else l
                cleaned.append(l)
            if len(cleaned) == len(products):
                for p, pt in zip(products, cleaned):
                    p["title"] = pt
                logger.info(f"Gemini traduziu {len(cleaned)} títulos")
                return products
        except Exception as e:
            logger.warning(f"Gemini falhou ({e}) — usando MyMemory")

    # Fallback: MyMemory
    logger.info(f"Traduzindo {len(products)} títulos via MyMemory...")
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for p in products:
            pt = await _translate_one_mymemory(client, p["title_en"])
            if pt and pt != p["title_en"]:
                p["title"] = pt
            await asyncio.sleep(0.12)
    logger.info("Tradução MyMemory concluída")
    return products


async def fetch_hot_products(usd_brl: float = 6.10, limit: int = 50) -> list:
    """Busca HOT products, aplica filtros, enriquece com ML e traduz títulos."""
    logger.info(f"Hot Miner v3: {len(CATEGORIES)} nichos | ≤${MAX_COST_USD} | score≥{MIN_SCORE}")
    results = []

    async with httpx.AsyncClient(follow_redirects=True) as client:
        tasks       = [_fetch_category(client, cid, cname) for cid, cname, _ in CATEGORIES]
        all_batches = await asyncio.gather(*tasks)

    passed = failed = 0
    for (cid, cname, kw), batch in zip(CATEGORIES, all_batches):
        for raw in batch:
            try:
                mapped = _map_product(raw, cname, kw, usd_brl)
                if mapped:
                    results.append(mapped)
                    passed += 1
                else:
                    failed += 1
            except Exception as e:
                logger.warning(f"Erro ao mapear {raw.get('product_id')}: {e}")
                failed += 1

    logger.info(f"Hot Miner: {passed} aprovados pre-ML, {failed} rejeitados")

    # Deduplica e ordena por score
    seen, unique = set(), []
    for p in sorted(results, key=lambda x: x["score"], reverse=True):
        if p["product_id"] not in seen:
            seen.add(p["product_id"])
            unique.append(p)

    top = unique[:limit]

    # Enriquece com status Mercado Livre
    top = await _enrich_with_ml(top)

    # Filtra score mínimo após ML (alguns podem ter caído abaixo de 75)
    top = [p for p in top if p["score"] >= MIN_SCORE]

    # Traduz títulos
    top = await _translate_titles(top)

    logger.info(f"Hot Miner v3: {len(top)} produtos prontos")
    return top
