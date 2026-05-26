const OpenAI = require('openai');

const systemPrompt = `Você é um especialista em SEO e vendas para o marketplace Shopee Brasil.
Sua tarefa é otimizar listings de produtos para maximizar visibilidade e conversão.
Você conhece profundamente os termos mais buscados pelos compradores brasileiros na Shopee.
Sempre responda em português brasileiro.
Retorne APENAS um JSON válido, sem markdown, sem explicações fora do JSON.`;

/**
 * Analyzes product image with GPT-4o vision and returns optimized text + metadata.
 * @param {string} imageBase64 - Base64-encoded product image
 * @param {string} mimeType - Image MIME type (e.g. image/jpeg)
 * @param {string} title - Original product title
 * @param {string} description - Original product description
 * @param {string} apiKey - OpenAI API key
 * @returns {{ optimizedTitle, optimizedDescription, productCategory, keywords }}
 */
async function generateOptimizedText(imageBase64, mimeType, title, description, apiKey) {
  const client = new OpenAI({ apiKey });

  const userPrompt = `Analise esta imagem de produto e as informações fornecidas:

TÍTULO ORIGINAL: ${title}
DESCRIÇÃO ORIGINAL: ${description}

Com base na análise visual da imagem e nas informações acima, retorne um JSON com este formato exato:
{
  "optimizedTitle": "título aqui com palavras-chave SEO Shopee, máx 120 caracteres",
  "optimizedDescription": "descrição completa aqui com emojis, bullets e CTA, mínimo 300 palavras",
  "productCategory": "categoria identificada em português",
  "keywords": ["palavra1", "palavra2", "palavra3", "palavra4", "palavra5"]
}

Regras obrigatórias:
- optimizedTitle: máximo 120 caracteres, com as palavras-chave mais buscadas na Shopee para esse tipo de produto
- optimizedDescription: mínimo 300 palavras, estruturada com emojis estratégicos (✅ ⭐ 🔥 📦 🎁 💎 🛡️ 🚀), seções com bullets de benefícios, especificações técnicas, garantia/entrega, e CTA forte no final
- productCategory: categoria em português (ex: "Ferramentas Elétricas", "Eletrônicos", "Moda Feminina")
- keywords: 5 termos exatos mais buscados na Shopee Brasil para esse produto`;

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
    temperature: 0.5,
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

  return parsed;
}

module.exports = { generateOptimizedText };
