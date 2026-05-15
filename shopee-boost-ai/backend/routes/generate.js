const express = require('express');
const multer = require('multer');
const { generateOptimizedText } = require('../services/textService');
const { generateProductImages } = require('../services/imageService');

const router = express.Router();

// Store upload in memory (no disk I/O) — max 10MB
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

/**
 * POST /api/generate
 * Body: multipart/form-data { image, title, description }
 * Header: x-openai-key
 */
router.post('/generate', upload.single('image'), async (req, res) => {
  try {
    // --- Validate API key ---
    const apiKey = req.headers['x-openai-key'];
    if (!apiKey || !apiKey.startsWith('sk-')) {
      return res.status(400).json({
        error: 'Chave de API inválida. Verifique sua OpenAI API Key.',
      });
    }

    // --- Validate required fields ---
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

    // Convert image buffer to base64
    const imageBase64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // Step 1: Analyze image + generate optimized text
    console.log('[generate] Running GPT-4o text optimization...');
    const { optimizedTitle, optimizedDescription, productCategory, keywords } =
      await generateOptimizedText(imageBase64, mimeType, title.trim(), description.trim(), apiKey);

    // Step 2: Generate 6 product images with DALL-E 3
    console.log('[generate] Generating 6 images with DALL-E 3...');
    const images = await generateProductImages(optimizedTitle, productCategory, keywords, apiKey);

    res.json({
      optimizedTitle,
      optimizedDescription,
      productCategory,
      keywords,
      images,
    });
  } catch (err) {
    console.error('[generate] Error:', err.message);

    // Map OpenAI error codes to user-friendly messages
    if (err.status === 401 || err.code === 'invalid_api_key') {
      return res.status(401).json({
        error: 'Chave de API inválida. Verifique sua OpenAI API Key.',
      });
    }
    if (err.status === 429) {
      return res.status(429).json({
        error: 'Limite de requisições atingido. Aguarde alguns segundos e tente novamente.',
      });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'Imagem muito grande. Use imagens até 10MB.',
      });
    }
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
      return res.status(504).json({
        error: 'O processo demorou mais que o esperado. Tente novamente.',
      });
    }
    if (err.message && err.message.includes('content_policy')) {
      return res.status(400).json({
        error: 'Imagem recusada pela política de conteúdo da OpenAI. Use outra imagem.',
      });
    }

    res.status(500).json({
      error: err.message || 'Erro ao processar produto. Tente novamente.',
    });
  }
});

module.exports = router;
