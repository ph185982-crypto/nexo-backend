"""
Product Miner — motor de mineração de produtos AliExpress.
Combina scraping direto + RapidAPI + verificação Mercado Livre BR.
"""
import asyncio, httpx, os, re, logging
from typing import List, Dict, Optional
from bs4 import BeautifulSoup
from services.translator import translate_title
from services.profit_calculator import ProfitCalculator

logger = logging.getLogger(__name__)

RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "")

KEYWORDS = [
    "massage gun electric",
    "hair straightener brush rotating",
    "led face mask beauty device",
    "automatic cat toy feather",
    "portable blender bottle usb",
    "magnetic phone holder car",
    "knee massager heat electric",
    "posture corrector back support",
    "uv nail lamp gel professional",
    "dog water bottle portable",
    "eye massager vibration heat",
    "scalp massager electric shampoo",
    "resistance bands set workout",
    "foam roller muscle massage",
    "teeth whitening led kit",
    "cellulite massager electric body",
    "plant grow light led indoor",
    "baby nasal aspirator electric",
    "coffee frother electric mini",
    "compression socks running sport",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
}

CATEGORY_MAP = {
    "massage": "Saúde", "massager": "Saúde", "knee": "Saúde", "posture": "Saúde",
    "eye massager": "Saúde", "nasal": "Bebê", "baby": "Bebê",
    "hair": "Beleza", "face mask": "Beleza", "led face": "Beleza",
    "nail": "Beleza", "teeth": "Beleza", "cellulite": "Beleza", "scalp": "Beleza",
    "cat toy": "Pet", "dog water": "Pet", "pet": "Pet",
    "resistance bands": "Fitness", "foam roller": "Fitness", "compression socks": "Fitness",
    "blender": "Casa", "coffee frother": "Casa", "plant grow": "Casa",
    "phone holder": "Eletrônicos", "magnetic": "Eletrônicos",
}


def _guess_category(keyword: str) -> str:
    kl = keyword.lower()
    for k, cat in CATEGORY_MAP.items():
        if k in kl:
            return cat
    return "Outros"


def _score_product(p: Dict, br_status: str) -> int:
    score = 0
    markup = p.get("markup", 0)
    orders = p.get("orders_count", 0)
    rating = p.get("rating", 0)

    if markup >= 6:   score += 30
    elif markup >= 4: score += 20
    elif markup >= 3: score += 10

    if br_status == "Não Vendido":   score += 25
    elif br_status == "Pouco Vendido": score += 15
    else:                              score += 5

    if orders >= 100000: score += 20
    elif orders >= 50000: score += 15
    elif orders >= 10000: score += 8

    if rating >= 4.8: score += 15
    elif rating >= 4.5: score += 10
    elif rating >= 4.3: score += 5

    return min(score, 100)


async def _check_br_saturation(keyword: str) -> str:
    """Verifica saturação no Mercado Livre Brasil via RapidAPI."""
    if not RAPIDAPI_KEY:
        return "Pouco Vendido"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://mercadolivre2.p.rapidapi.com/search",
                params={"query": keyword, "site": "MLB"},
                headers={
                    "x-rapidapi-host": "mercadolivre2.p.rapidapi.com",
                    "x-rapidapi-key": RAPIDAPI_KEY,
                }
            )
            if r.status_code == 200:
                data = r.json()
                results = data.get("results", [])
                count = len(results)
                if count < 5:   return "Não Vendido"
                if count < 50:  return "Pouco Vendido"
                return "Já Vendido"
    except Exception as e:
        logger.debug(f"ML saturation check falhou para '{keyword}': {e}")
    return "Pouco Vendido"


async def _search_aliexpress_api(keyword: str, calc: ProfitCalculator, rate: float) -> List[Dict]:
    """Busca via AliExpress DataHub RapidAPI."""
    if not RAPIDAPI_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                "https://aliexpress-datahub.p.rapidapi.com/item-search-2",
                params={"keywords": keyword, "page": "1", "sort": "SALE_PRICE_ASC"},
                headers={
                    "x-rapidapi-host": "aliexpress-datahub.p.rapidapi.com",
                    "x-rapidapi-key": RAPIDAPI_KEY,
                }
            )
            if r.status_code != 200:
                return []
            data = r.json()
            items = data.get("result", {}).get("resultList", []) or []
            products = []
            for item in items[:15]:
                info = item.get("item", {})
                price_str = str(info.get("sku", {}).get("def", {}).get("promotionPrice", "0"))
                price = float(re.sub(r"[^\d.]", "", price_str) or "0")
                if price < 2 or price > 20:
                    continue
                orders = int(info.get("tradeDesc", "0 sold").split()[0].replace(",", "") or "0")
                rating = float(info.get("averageStar", "4.3") or "4.3")
                if orders < 5000 or rating < 4.3:
                    continue
                profit = calc.calculate(price, usd_brl=rate, freight_usd=3.0)
                if profit["markup"] < 3.0:
                    continue
                img = info.get("image", "")
                if not img.startswith("https://"):
                    img = "https:" + img if img.startswith("//") else ""
                if not img:
                    continue
                title_en  = info.get("title", keyword)
                title_pt  = translate_title(title_en)
                products.append({
                    "title": title_pt,
                    "category": _guess_category(keyword),
                    "platform": "aliexpress",
                    "price_usd": price,
                    "orders_count": orders,
                    "rating": rating,
                    "images": [img],
                    "image_url": img,
                    "product_url": f"https://www.aliexpress.com/item/{info.get('itemId','')}.html",
                    "tags": keyword.split()[:4],
                    **profit,
                })
            return products
    except Exception as e:
        logger.warning(f"AliExpress API falhou para '{keyword}': {e}")
        return []


async def _mine_keyword(keyword: str, calc: ProfitCalculator, rate: float) -> List[Dict]:
    br_status, products = await asyncio.gather(
        _check_br_saturation(keyword),
        _search_aliexpress_api(keyword, calc, rate),
    )
    for p in products:
        p["br_status"] = br_status
        p["score"]     = _score_product(p, br_status)
        p["opportunity"] = 90 if br_status == "Não Vendido" else 65 if br_status == "Pouco Vendido" else 25
        p["saturation_pct"] = 5 if br_status == "Não Vendido" else 30 if br_status == "Pouco Vendido" else 70
        p["is_new"]   = False
        p["is_viral"] = p["score"] >= 85
        p["highlight"] = p["score"] >= 85
        p["growth"]   = "+0%"
        p["delivery_days"] = "15-25"
    return [p for p in products if p["score"] >= 65]


async def mine_products(max_results: int = 200) -> List[Dict]:
    """Minera produtos de todas as keywords e retorna top N por score."""
    calc = ProfitCalculator()
    rate = await calc.get_live_usd_rate()
    logger.info(f"Minerando {len(KEYWORDS)} keywords @ USD/BRL={rate:.2f}")

    tasks = [_mine_keyword(kw, calc, rate) for kw in KEYWORDS]
    results_nested = await asyncio.gather(*tasks, return_exceptions=True)

    all_products = []
    for batch in results_nested:
        if isinstance(batch, list):
            all_products.extend(batch)

    # Deduplica por título
    seen, unique = set(), []
    for p in all_products:
        key = p["title"][:40].lower()
        if key not in seen:
            seen.add(key)
            unique.append(p)

    unique.sort(key=lambda x: x["score"], reverse=True)
    logger.info(f"Mineração concluída: {len(unique)} produtos únicos encontrados")
    return unique[:max_results]
