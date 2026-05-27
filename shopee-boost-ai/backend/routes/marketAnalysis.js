const express = require('express');
const OpenAI = require('openai');

const router = express.Router();

/**
 * POST /api/market-analysis
 * Body: { category?: string, keyword?: string }
 */
router.post('/market-analysis', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Servidor não configurado. Contate o suporte.' });
    }

    const { category = '', keyword = '' } = req.body;

    const openai = new OpenAI({ apiKey });

    const userPrompt = `Analise o mercado Shopee Brasil ${category ? `para a categoria: ${category}` : ''} ${keyword ? `focando no produto/palavra-chave: "${keyword}"` : 'em geral'}.

Retorne um JSON com este formato exato:
{
  "trendingKeywords": [
    {
      "keyword": "termo buscado",
      "volume": "Alto|Médio|Baixo",
      "competition": "Alta|Média|Baixa",
      "trend": "up|stable|down",
      "insight": "dica de uso desta keyword"
    }
  ],
  "topProducts": [
    {
      "title": "nome do produto mais vendido",
      "priceRange": "R$ X – R$ Y",
      "monthlySales": "estimativa mensal",
      "opportunity": "descrição da oportunidade",
      "differentials": ["diferencial1", "diferencial2", "diferencial3"],
      "searchKeyword": "keyword para buscar este produto na Shopee"
    }
  ],
  "insights": ["insight1", "insight2", "insight3", "insight4", "insight5"]
}

Regras:
- trendingKeywords: 12 palavras-chave reais que compradores brasileiros buscam na Shopee para este tipo de produto, em português
- topProducts: 6 produtos que realmente vendem bem nesta categoria/keyword na Shopee Brasil, com estimativas realistas
- insights: 5 insights estratégicos sobre este mercado (sazonalidade, estratégia de precificação, títulos que convertem, etc.)
- Seja específico e realista — dados baseados em conhecimento real do Shopee Brasil`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.3,
      max_tokens: 3000,
      messages: [
        {
          role: 'system',
          content:
            'Você é um especialista em análise de mercado para o marketplace Shopee Brasil.\nVocê conhece em detalhes quais produtos vendem mais, as palavras-chave mais buscadas pelos compradores brasileiros, tendências de mercado e estratégias de precificação no Shopee Brasil.\nRetorne APENAS JSON válido, sem markdown, sem texto fora do JSON.',
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || '';

    // Strip potential markdown code fences
    const jsonText = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.error('[market-analysis] Failed to parse GPT response:', raw.slice(0, 300));
      return res.status(500).json({ error: 'Erro ao interpretar resposta da IA. Tente novamente.' });
    }

    const { trendingKeywords = [], topProducts = [], insights = [] } = parsed;

    // Enrich with Shopee deep links
    trendingKeywords.forEach((kw) => {
      kw.shopeeUrl = `https://shopee.com.br/search?keyword=${encodeURIComponent(kw.keyword)}&sortBy=sales`;
    });

    topProducts.forEach((product) => {
      product.shopeeUrl = `https://shopee.com.br/search?keyword=${encodeURIComponent(product.searchKeyword || product.title)}&sortBy=sales`;
    });

    return res.json({
      category: category || null,
      keyword: keyword || null,
      trendingKeywords,
      topProducts,
      insights,
      searchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[market-analysis] Error:', err.status || '', err.message);

    const status = err.status || err.statusCode || 500;
    if (status === 401) {
      return res.status(401).json({ error: 'Chave de API da OpenAI inválida ou sem permissão.' });
    }
    if (status === 429) {
      return res.status(429).json({ error: 'Limite de requisições da OpenAI atingido. Aguarde 1 minuto e tente novamente.' });
    }

    return res.status(500).json({ error: 'Erro ao analisar mercado. Tente novamente.' });
  }
});

module.exports = router;
