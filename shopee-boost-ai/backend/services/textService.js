const OpenAI = require('openai');

const systemPrompt = `Você é um especialista em SEO e vendas para o marketplace Shopee Brasil.
Sua tarefa é otimizar listings de produtos para maximizar visibilidade e conversão.
Você conhece profundamente os termos mais buscados pelos compradores brasileiros na Shopee.
Você analisa imagens de produtos com precisão visual extrema para descrever cada detalhe.
Sempre responda em português brasileiro.
Retorne APENAS um JSON válido, sem markdown, sem explicações fora do JSON.`;

/**
 * Analyzes product image with GPT-4o Vision and returns optimized text + metadata.
 *
 * @param {string} imageBase64 - Base64-encoded product image
 * @param {string} mimeType - Image MIME type (e.g. image/jpeg)
 * @param {string} title - Original product title
 * @param {string} description - Original product description
 * @param {string[]} shopeeKeywords - Keywords fetched from Shopee (may be empty)
 * @param {string} apiKey - OpenAI API key
 * @returns {Promise<{
 *   optimizedTitle: string,
 *   optimizedDescription: string,
 *   productCategory: string,
 *   keywords: string[],
 *   productVisualDescription: string,
 *   differentials: string[],
 *   purchaseObjections: string[],
 *   sellerTrustPoints: string[]
 * }>}
 */
async function generateOptimizedText(imageBase64, mimeType, title, description, shopeeKeywords, apiKey) {
  const client = new OpenAI({ apiKey });

  const shopeeKwSection = shopeeKeywords && shopeeKeywords.length > 0
    ? `\n\nPALAVRAS-CHAVE REAIS DA SHOPEE (incorpore no título e descrição):\n${shopeeKeywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}`
    : '';

  const userPrompt = `Analise esta imagem de produto e as informações fornecidas:

TÍTULO ORIGINAL: ${title}
DESCRIÇÃO ORIGINAL: ${description}${shopeeKwSection}

Com base na análise visual detalhada da imagem e nas informações acima, retorne um JSON com este formato exato:
{
  "optimizedTitle": "título aqui com palavras-chave SEO Shopee, máx 120 caracteres",
  "optimizedDescription": "descrição completa aqui com emojis, bullets e CTA, mínimo 300 palavras",
  "productCategory": "categoria identificada em português",
  "keywords": ["palavra1", "palavra2", "palavra3", "palavra4", "palavra5"],
  "productVisualDescription": "descrição visual ULTRA-DETALHADA do produto para geração de imagem por IA — cores exatas (ex: azul royal metálico, preto fosco), forma exata, todas as partes visíveis, materiais, texturas, marcas/logos, características distintivas e ângulo predominante da foto",
  "differentials": ["diferencial1", "diferencial2", "diferencial3", "diferencial4"],
  "purchaseObjections": ["resposta_objecao1", "resposta_objecao2", "resposta_objecao3"],
  "sellerTrustPoints": ["ponto_confianca1", "ponto_confianca2", "ponto_confianca3"]
}

Regras obrigatórias para cada campo:

optimizedTitle: máximo 120 caracteres, com as palavras-chave mais buscadas na Shopee para esse tipo de produto.${shopeeKeywords && shopeeKeywords.length > 0 ? ' OBRIGATÓRIO: incorpore as palavras-chave reais da Shopee fornecidas acima.' : ''}

optimizedDescription: mínimo 300 palavras, estruturada com emojis estratégicos (✅ ⭐ 🔥 📦 🎁 💎 🛡️ 🚀), seções com bullets de benefícios, especificações técnicas, garantia/entrega, e CTA forte no final.

productCategory: categoria em português (ex: "Ferramentas Elétricas", "Eletrônicos", "Moda Feminina").

keywords: 5 termos exatos mais buscados na Shopee Brasil para esse produto.

productVisualDescription: Descrição visual ULTRA-DETALHADA do produto exclusivamente para uso como prompt de geração de imagem por IA. Deve incluir:
- Cores exatas (ex: "azul royal metálico", "preto fosco")
- Forma exata e geometria
- Todas as partes visíveis e componentes
- Materiais e texturas aparentes
- Qualquer texto, marca ou logotipo visível no produto
- Características distintivas e acabamentos
- Ângulo de visão predominante na foto
Seja tão detalhado que uma IA possa recriar exatamente esse produto sem ver a foto original.

differentials: 4 vantagens ESPECÍFICAS DESTE produto (baseadas na análise visual e descrição), não genéricas. Ex: "Bateria de 40h de duração", "Cancelamento de ruído ativo".

purchaseObjections: 3 razões comuns pelas quais pessoas NÃO compram esse tipo de produto, respondidas de forma persuasiva em português brasileiro. Máximo 8 palavras cada. Ex: "Qualidade garantida com certificação original", "Entrega rápida com rastreamento completo".

sellerTrustPoints: 3 razões para comprar deste vendedor específico. Ex: "Envio em 24h", "Garantia de 12 meses", "Produto original certificado".`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
              detail: 'high',
            },
          },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
    max_tokens: 3000,
    temperature: 0.4,
  });

  const rawContent = response.choices[0].message.content.trim();

  // Strip markdown code fences if model wraps the JSON
  const jsonString = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    // Last-resort: try to extract JSON with a regex
    const match = jsonString.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        throw new Error('Falha ao interpretar resposta da IA. Tente novamente.');
      }
    } else {
      throw new Error('Falha ao interpretar resposta da IA. Tente novamente.');
    }
  }

  if (!parsed.optimizedTitle || !parsed.optimizedDescription) {
    throw new Error('Resposta da IA incompleta. Tente novamente.');
  }

  if (parsed.optimizedTitle.length > 120) {
    parsed.optimizedTitle = parsed.optimizedTitle.substring(0, 120);
  }

  // Ensure arrays exist with defaults
  if (!Array.isArray(parsed.keywords)) parsed.keywords = [];
  if (!Array.isArray(parsed.differentials)) parsed.differentials = ['Alta qualidade', 'Durável', 'Fácil de usar', 'Ótimo custo-benefício'];
  if (!Array.isArray(parsed.purchaseObjections)) parsed.purchaseObjections = ['Qualidade garantida e verificada', 'Entrega rápida com rastreamento', 'Suporte ao cliente disponível'];
  if (!Array.isArray(parsed.sellerTrustPoints)) parsed.sellerTrustPoints = ['Envio em 24h', 'Garantia de 12 meses', 'Produto original certificado'];
  if (!parsed.productVisualDescription) parsed.productVisualDescription = parsed.optimizedTitle;
  if (!parsed.productCategory) parsed.productCategory = 'Produto';

  return parsed;
}

module.exports = { generateOptimizedText };
