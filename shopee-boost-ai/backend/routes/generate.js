const express = require('express');
const multer = require('multer');
const { searchShopeeKeywords } = require('../services/keywordService');
const { generateOptimizedText } = require('../services/textService');
const { generateProductImages } = require('../services/imageService');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Apenas arquivos de imagem são aceitos.'));
    }
    cb(null, true);
  },
});

function mapOpenAIError(err) {
  const msg = err.message || '';
  const status = err.status || err.statusCode || 500;

  if (status === 401 || err.code === 'invalid_api_key') {
    return { status: 401, error: 'Chave de API da OpenAI inválida ou sem permissão.' };
  }
  if (status === 429) {
    return { status: 429, error: 'Limite de requisições da OpenAI atingido. Aguarde 1 minuto e tente novamente.' };
  }
  if (status === 400 && msg.includes('billing')) {
    return { status: 402, error: 'Conta OpenAI sem créditos. Verifique seu saldo em platform.openai.com.' };
  }
  if (msg.toLowerCase().includes('content_policy') || msg.toLowerCase().includes('safety')) {
    return { status: 400, error: 'A imagem foi recusada pela política de conteúdo da OpenAI. Use outra imagem do produto.' };
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return { status: 413, error: 'Imagem muito grande. Use imagens de até 10MB.' };
  }
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || status === 504) {
    return { status: 504, error: 'Tempo limite excedido. Tente novamente.' };
  }
  if (msg.includes('Falha ao interpretar') || msg.includes('Resposta da IA')) {
    return { status: 500, error: msg };
  }
  return { status: 500, error: `Erro ao processar o produto: ${msg || 'tente novamente.'}` };
}

/**
 * POST /api/generate
 * Body: multipart/form-data { image (PNG preferred), title, description }
 */
router.post('/generate', upload.single('image'), async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Servidor não configurado. Contate o suporte.' });
    }

    const { title, description } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: 'Imagem do produto é obrigatória.' });
    }
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Título do produto é obrigatório.' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Descrição do produto é obrigatória.' });
    }

    const imageBuffer = req.file.buffer;
    const imageBase64 = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype;

    console.log(`[generate] Starting for: "${title.trim()}" (${mimeType}, ${imageBuffer.length} bytes)`);

    // Step 1 — Shopee keyword search (best-effort, empty array on failure)
    const shopeeKeywords = await searchShopeeKeywords(title.trim());
    console.log(`[generate] Shopee keywords: ${shopeeKeywords.length > 0 ? shopeeKeywords.join(', ') : 'none (using GPT-4o keywords)'}`);

    // Step 2 — GPT-4o Vision: analyze image + generate all text + visual description
    const {
      optimizedTitle,
      optimizedDescription,
      productCategory,
      keywords,
      productVisualDescription,
      differentials,
      purchaseObjections,
      sellerTrustPoints,
    } = await generateOptimizedText(
      imageBase64,
      mimeType,
      title.trim(),
      description.trim(),
      shopeeKeywords,
      apiKey
    );

    console.log(`[generate] Text done. Category: ${productCategory}. Generating 5 images...`);

    // Step 3 — gpt-image-1 via images.edit: 5 images using product photo as reference
    const images = await generateProductImages(
      imageBuffer,
      mimeType,
      productVisualDescription,
      productCategory,
      differentials,
      purchaseObjections,
      sellerTrustPoints,
      apiKey
    );

    console.log(`[generate] Done. ${images.length} images generated.`);

    res.json({
      optimizedTitle,
      optimizedDescription,
      productCategory,
      keywords,
      images,
    });

  } catch (err) {
    console.error('[generate] Error:', err.status || '', err.message);
    const { status, error } = mapOpenAIError(err);
    res.status(status).json({ error });
  }
});

module.exports = router;
