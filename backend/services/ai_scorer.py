"""AI Scorer — Gemini-powered product scoring and analysis"""
import google.generativeai as genai
import json, os, logging, asyncio
from typing import Dict, List

logger = logging.getLogger(__name__)

genai.configure(api_key=os.getenv("GOOGLE_API_KEY", ""))
_model = genai.GenerativeModel("gemini-1.5-flash")


async def _generate(prompt: str) -> str:
    response = await asyncio.to_thread(_model.generate_content, prompt)
    return response.text


class AIScorer:
    async def score_product(self, product: Dict, br_status: str, profit: Dict, google_trend=0, fb_ads=0) -> int:
        s = 0
        markup = profit.get("markup", 0)
        if markup >= 5: s += 30
        elif markup >= 4: s += 25
        elif markup >= 3.5: s += 20
        elif markup >= 3: s += 15
        else: s += 5
        s += {"Não Vendido": 25, "Pouco Vendido": 15, "Já Vendido": 5}.get(br_status, 0)
        orders = product.get("orders_count", 0)
        if orders >= 100000: s += 20
        elif orders >= 50000: s += 16
        elif orders >= 10000: s += 12
        elif orders >= 1000: s += 8
        elif orders >= 100: s += 4
        s += min(15, round(google_trend * 0.15))
        if fb_ads >= 50: s += 10
        elif fb_ads >= 20: s += 8
        elif fb_ads >= 5: s += 5
        elif fb_ads >= 1: s += 3
        return min(100, s)

    async def analyze_product(self, product: Dict) -> Dict:
        prompt = f"""Você é um estrategista especializado em e-commerce e importação para o Brasil.

Analise este produto:
PRODUTO: {product.get('title','')}
PREÇO ORIGEM: ${product.get('price_usd',0):.2f} USD
CUSTO TOTAL IMPORTADO: R${product.get('total_cost_brl',0):.2f}
PREÇO SUGERIDO: R${product.get('suggested_sell_price',0):.2f}
MARKUP: {product.get('markup',0):.2f}x
PEDIDOS GLOBAIS: {product.get('orders_count',0):,}
STATUS NO BRASIL: {product.get('br_status','N/A')}
SCORE: {product.get('score',0)}/100

Responda SOMENTE com JSON válido, sem markdown:
{{"headline":"frase de oportunidade em 1 linha","nota":8.5,"publico":"público-alvo ideal","melhorCanal":"melhor canal no Brasil","copys":["copy1 gancho+promessa","copy2 dor+solução","copy3 prova social+urgência"],"objecoes":["Objeção: X → Resposta: Y","Objeção: X → Resposta: Y"],"palavrasChave":["kw1","kw2","kw3","kw4","kw5"],"risco":"principal risco","melhorEpoca":"melhor época do ano","estrategia":"Passo 1: ... | Passo 2: ... | Passo 3: ...","precificacaoIdeal":{{"shopee":0,"mercadoLivre":0,"instagram":0}}}}"""
        try:
            text = await _generate(prompt)
            return json.loads(text.replace("```json","").replace("```","").strip())
        except Exception as e:
            logger.error(f"analyze_product: {e}")
            return {"error": str(e)}

    async def check_viability(self, product: Dict) -> Dict:
        prompt = f"""Você é um analista de e-commerce brasileiro experiente. Avalie a viabilidade comercial deste produto para vender no Brasil.

PRODUTO: {product.get('title','')}
PREÇO ORIGEM: ${product.get('price_usd',0):.2f} USD
MARKUP: {product.get('markup',0):.2f}x
PEDIDOS GLOBAIS: {product.get('orders_count',0):,}
STATUS NO BRASIL: {product.get('br_status','N/A')}
CATEGORIA: {product.get('category','N/A')}

Responda SOMENTE com JSON válido, sem markdown:
{{"veredicto":"Aprovado","pontuacao":8.5,"resumo":"1-2 frases explicando o veredicto","pontos_fortes":["ponto 1","ponto 2","ponto 3"],"pontos_fracos":["risco 1","risco 2"],"recomendacao":"ação concreta recomendada","canal_ideal":"Shopee/MercadoLivre/Instagram/TikTok","prazo_retorno":"estimativa de retorno do investimento"}}

veredicto deve ser exatamente: "Aprovado", "Aprovado com ressalvas" ou "Reprovado"."""
        try:
            text = await _generate(prompt)
            return json.loads(text.replace("```json","").replace("```","").strip())
        except Exception as e:
            logger.error(f"check_viability: {e}")
            return {"error": str(e)}

    async def generate_keywords(self, product: Dict) -> Dict:
        prompt = f"""Você é um especialista em SEO para e-commerce brasileiro (Shopee, MercadoLivre, Google Shopping).

PRODUTO: {product.get('title','')}
CATEGORIA: {product.get('category','N/A')}
PÚBLICO: compradores brasileiros online

Gere palavras-chave estratégicas para maximizar vendas no Brasil.

Responda SOMENTE com JSON válido, sem markdown:
{{"keywords_principais":["kw1","kw2","kw3","kw4","kw5"],"keywords_cauda_longa":["frase 1 com 3-5 palavras","frase 2","frase 3","frase 4","frase 5"],"hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5","#tag6","#tag7","#tag8"],"termos_negativos":["termo a evitar 1","termo a evitar 2"],"busca_volume":"Alto/Médio/Baixo","dica_seo":"dica específica para esse produto"}}"""
        try:
            text = await _generate(prompt)
            return json.loads(text.replace("```json","").replace("```","").strip())
        except Exception as e:
            logger.error(f"generate_keywords: {e}")
            return {"error": str(e)}

    async def generate_titles(self, product: Dict) -> Dict:
        prompt = f"""Você é um copywriter especialista em e-commerce brasileiro, expert em criar títulos que vendem.

PRODUTO: {product.get('title','')}
CATEGORIA: {product.get('category','N/A')}
PREÇO SUGERIDO: R${product.get('suggested_sell_price',0):.2f}
MARKUP: {product.get('markup',0):.2f}x

Crie títulos magnéticos para diferentes canais de venda no Brasil.

Responda SOMENTE com JSON válido, sem markdown:
{{"titulo_shopee":"título otimizado para Shopee (máx 120 chars, inclua palavras-chave)","titulo_mercadolivre":"título para ML (máx 60 chars, direto ao ponto)","titulo_instagram":"título para post Instagram (gancho emocional)","titulo_tiktok":"título para TikTok (trend + curiosidade)","cta_principal":"call-to-action mais forte","gancho_video":"primeira frase para vídeo de 15s que prende atenção","descricao_curta":"descrição de 2 linhas para anúncio"}}"""
        try:
            text = await _generate(prompt)
            return json.loads(text.replace("```json","").replace("```","").strip())
        except Exception as e:
            logger.error(f"generate_titles: {e}")
            return {"error": str(e)}

    async def generate_market_insights(self, products: List[Dict]) -> Dict:
        summary = "\n".join([f"- {p.get('title','')}: score {p.get('score',0)}, markup {p.get('markup',0):.1f}x, BR: {p.get('br_status','')}" for p in products[:15]])
        prompt = f"""Analista de mercado de e-commerce brasileiro. Produtos em tendência detectados:
{summary}

Responda SOMENTE com JSON válido:
{{"semana":"tendência principal desta semana","categoriaQuente":"categoria com mais oportunidade","tendencias":[{{"nome":"nome","score":95,"crescimento":"+320%","descricao":"1 frase","emoji":"🔥"}},{{"nome":"nome","score":88,"crescimento":"+180%","descricao":"1 frase","emoji":"⚡"}},{{"nome":"nome","score":82,"crescimento":"+140%","descricao":"1 frase","emoji":"📈"}},{{"nome":"nome","score":76,"crescimento":"+95%","descricao":"1 frase","emoji":"💡"}}],"alertas":["alerta 1","alerta 2","alerta 3"],"previsao":"próximas 4 semanas","melhorMes":"melhor período e por quê"}}"""
        try:
            text = await _generate(prompt)
            return json.loads(text.replace("```json","").replace("```","").strip())
        except Exception as e:
            logger.error(f"market_insights: {e}")
            return {"error": str(e)}

    async def analyze_market_gap(self, gaps: List[Dict]) -> Dict:
        names = ", ".join([g.get("title","") for g in gaps[:8]])
        prompt = f"""Especialista em market gap analysis para e-commerce brasileiro.
Produtos sem/poucos concorrentes no Brasil: {names}

Responda SOMENTE com JSON válido:
{{"melhorOportunidade":"produto com maior oportunidade","motivo":"por que é a melhor oportunidade (2-3 frases)","gaps":[{{"produto":"nome","gap":"descrição da lacuna","urgencia":"Alta","motivo":"por que existe"}},{{"produto":"nome","gap":"descrição da lacuna","urgencia":"Média","motivo":"por que existe"}}],"estrategia":"como aproveitar (detalhado)","janela":"quanto tempo essa janela dura"}}"""
        try:
            text = await _generate(prompt)
            return json.loads(text.replace("```json","").replace("```","").strip())
        except Exception as e:
            logger.error(f"gap_analysis: {e}")
            return {"error": str(e)}
