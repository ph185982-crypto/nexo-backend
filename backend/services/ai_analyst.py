"""AI Analyst — structured product intelligence via Google Gemini"""
import asyncio, logging, json, re
import google.generativeai as genai
import os

genai.configure(api_key=os.getenv("GOOGLE_API_KEY", ""))
_model = genai.GenerativeModel("gemini-1.5-flash")
logger = logging.getLogger(__name__)


async def _generate(prompt: str) -> str:
    try:
        response = await asyncio.to_thread(_model.generate_content, prompt)
        return response.text
    except Exception as e:
        logger.error(f"Gemini error: {e}")
        return ""


def _parse_json(text: str) -> dict:
    """Extract first JSON object from model output."""
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return {}


async def analyze_product(product: dict) -> dict:
    """
    Returns structured intelligence:
    - score_br: 0-100 success potential in Brazil
    - competition_lvl: Baixa | Média | Alta
    - ad_creative_hook: best TikTok/FB angle
    - sales_projection: 30-day revenue estimate string
    - headline, nota, publico, palavrasChave, risco, copys, estrategia
    """
    title = product.get("title") or product.get("name") or "Produto"
    price = product.get("price_usd") or 0
    orders = product.get("orders_count") or 0
    markup = product.get("markup") or 0
    br_status = product.get("br_status") or "Desconhecido"
    category = product.get("category") or "Geral"
    sell_price = product.get("suggested_sell_price") or 0
    total_cost = product.get("total_cost_brl") or 0
    growth = product.get("growth") or "+0%"

    competition_lvl = (
        "Baixa" if br_status == "Não Vendido"
        else "Média" if br_status == "Pouco Vendido"
        else "Alta"
    )

    # Score BR heuristic (can be enriched by Gemini)
    base_score = min(100, int(
        (orders / 1000) * 0.3 +
        markup * 10 +
        (95 if br_status == "Não Vendido" else 60 if br_status == "Pouco Vendido" else 30) * 0.4
    ))

    prompt = f"""Você é um especialista em dropshipping no Brasil. Analise este produto e responda SOMENTE com JSON válido.

Produto: {title}
Categoria: {category}
Preço de custo: US$ {price:.2f}
Preço de venda sugerido: R$ {sell_price:.0f}
Custo total BRL: R$ {total_cost:.0f}
Markup: {markup:.1f}x
Vendas globais/mês: {orders:,}
Crescimento: {growth}
Status no Brasil: {br_status}

JSON esperado (preencha todos os campos, sem markdown):
{{
  "score_br": <número 0-100 representando potencial de sucesso no Brasil>,
  "competition_lvl": "<Baixa|Média|Alta>",
  "ad_creative_hook": "<melhor gancho de 1 frase para TikTok ou Facebook Ads>",
  "sales_projection": "<estimativa de faturamento nos primeiros 30 dias com estratégia básica>",
  "headline": "<análise de oportunidade em 1-2 frases>",
  "nota": <nota 0-10>,
  "publico": "<público-alvo ideal>",
  "palavrasChave": ["kw1","kw2","kw3","kw4","kw5"],
  "risco": "<principal risco do produto>",
  "copys": ["<copy1>","<copy2>","<copy3>"],
  "melhorCanal": "<canal recomendado>",
  "estrategia": "<estratégia de lançamento em 3-4 frases>"
}}"""

    raw = await _generate(prompt)
    parsed = _parse_json(raw)

    if not parsed:
        # Fallback with heuristics
        return {
            "score_br": base_score,
            "competition_lvl": competition_lvl,
            "ad_creative_hook": f"Descubra o produto que está vendendo {orders:,} unidades/mês no mundo todo — e ainda não chegou no Brasil!",
            "sales_projection": f"Com markup de {markup:.1f}x e custo de R${total_cost:.0f}, venda a R${sell_price:.0f}. Projeção: R${sell_price*30:.0f} em 30 dias com 30 vendas.",
            "headline": f"{title} tem {orders:,} vendas/mês globais e status '{br_status}' no Brasil — alta janela de arbitragem.",
            "nota": min(10, round(base_score / 10)),
            "publico": "Consumidores brasileiros buscando novidades internacionais",
            "palavrasChave": [category, "importado", "tendência", "dropshipping", "promoção"],
            "risco": "Dependência de fornecedor único no AliExpress",
            "copys": [
                f"O produto que vai explodir no Brasil — compre agora antes de saturar!",
                f"Importado direto, entrega rápida, qualidade garantida.",
                f"Veja por que {orders:,} pessoas já compraram esse produto.",
            ],
            "melhorCanal": "TikTok + Facebook Ads",
            "estrategia": f"Lance com 3-5 criativos no TikTok mostrando o produto em uso. Use R$50/dia no Facebook com público 25-45 anos interessados em {category}. Meta: 10 vendas na 1ª semana.",
        }

    # Ensure required fields
    parsed.setdefault("score_br", base_score)
    parsed.setdefault("competition_lvl", competition_lvl)
    parsed.setdefault("ad_creative_hook", parsed.get("copys", [""])[0] if parsed.get("copys") else "")
    parsed.setdefault("sales_projection", f"Projeção baseada em {orders:,} vendas globais mensais.")

    return parsed
