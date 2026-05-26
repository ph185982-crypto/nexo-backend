const OpenAI = require('openai');
const { toFile } = require('openai');

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Builds 5 expert-level prompts for gpt-image-1 marketplace product photography.
 * Uses the actual product image as reference via images.edit().
 *
 * @param {string} productVisualDescription - Ultra-detailed visual description for AI
 * @param {string} productCategory - Product category in Portuguese
 * @param {string[]} differentials - Product differentials (min 4)
 * @param {string[]} purchaseObjections - Objection-busting phrases (min 3)
 * @param {string[]} sellerTrustPoints - Trust points (min 3)
 * @returns {string[]} Array of 5 prompt strings
 */
function buildImagePrompts(productVisualDescription, productCategory, differentials, purchaseObjections, sellerTrustPoints) {
  return [
    // 1 — White Background: clean e-commerce hero shot
    `Remove the background from this exact product and place it on a pure white seamless background. Keep the product IDENTICAL - same model, colors, shape, and every detail as shown in the reference image. Professional e-commerce studio lighting with 3 softboxes, subtle drop shadow for depth, product centered and filling 80% of frame. No text, no watermarks, no additional objects. High-resolution Shopee/Amazon hero image standard.`,

    // 2 — Product in Use: lifestyle/aspirational shot
    `Show this exact product (identical to the reference image — same model, color, shape) being used naturally by a person. The product must be clearly recognizable as the same item shown. Aspirational lifestyle scene, appropriate environment for this type of product, natural interaction. Warm natural lighting, shallow depth of field. No text overlays. Photorealistic editorial photography.`,

    // 3 — Ambientalized + Differentials text overlay
    `Show this exact product (${productVisualDescription}) in an elegant lifestyle setting. Create a professional marketplace product banner. Include these product differentials as text labels in Brazilian Portuguese with clean typography and icons: '✅ ${differentials[0] || 'Alta qualidade'}', '⚡ ${differentials[1] || 'Durável'}', '💎 ${differentials[2] || 'Design exclusivo'}', '🔥 ${differentials[3] || differentials[0] || 'Melhor custo-benefício'}'. Place text in a sidebar or as badges overlaid on the image. Modern marketplace design, clean and easy to read.`,

    // 4 — Ambientalized + Objections: trust-building banner
    `Show this exact product (${productVisualDescription}) in a beautiful lifestyle setting. Create a professional marketplace banner that breaks purchase objections. Include these persuasive phrases in Brazilian Portuguese as text elements: '✅ ${purchaseObjections[0] || 'Qualidade garantida'}', '✅ ${purchaseObjections[1] || 'Entrega rápida'}', '✅ ${purchaseObjections[2] || 'Produto original'}'. Clean, confidence-building visual design with the text clearly readable. Professional marketplace photography.`,

    // 5 — Why Buy From Us: seller trust/credibility banner
    `Create a professional seller trust and credibility banner featuring this exact product (${productVisualDescription}). Include these trust badges and text elements in Brazilian Portuguese: '✅ ${sellerTrustPoints[0] || 'Envio em 24h'}', '🚀 ${sellerTrustPoints[1] || 'Garantia de 12 meses'}', '🛡️ ${sellerTrustPoints[2] || 'Produto original certificado'}', '📦 Frete Grátis Disponível', '⭐ Loja Verificada'. Include a tagline like 'POR QUE COMPRAR CONOSCO?' at the top. Trustworthy, professional marketplace design that builds customer confidence.`,
  ];
}

/**
 * Generates 5 product images SEQUENTIALLY using gpt-image-1 with images.edit().
 * Passes the actual product photo as reference for product fidelity.
 * Returns base64 data URLs so images never expire.
 *
 * @param {Buffer} imageBuffer - Raw image buffer from multer
 * @param {string} imageMimeType - MIME type of the image (e.g. 'image/png')
 * @param {string} productVisualDescription - Ultra-detailed visual description
 * @param {string} productCategory - Product category in Portuguese
 * @param {string[]} differentials - Product differentials (4 entries)
 * @param {string[]} purchaseObjections - Objection-busting phrases (3 entries)
 * @param {string[]} sellerTrustPoints - Seller trust points (3 entries)
 * @param {string} apiKey - OpenAI API key
 * @returns {Promise<string[]>} Array of 5 data URLs (data:image/png;base64,...)
 */
async function generateProductImages(
  imageBuffer,
  imageMimeType,
  productVisualDescription,
  productCategory,
  differentials,
  purchaseObjections,
  sellerTrustPoints,
  apiKey
) {
  const client = new OpenAI({ apiKey });

  const prompts = buildImagePrompts(
    productVisualDescription,
    productCategory,
    differentials,
    purchaseObjections,
    sellerTrustPoints
  );

  const dataUrls = [];

  for (let i = 0; i < prompts.length; i++) {
    const promptText = prompts[i];

    const attemptGeneration = async () => {
      // CRITICAL: create a fresh toFile() for each call — streams cannot be reused
      const imageFile = await toFile(imageBuffer, 'product.png', { type: imageMimeType });

      const result = await client.images.edit({
        model: 'gpt-image-1',
        image: imageFile,
        prompt: promptText,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
      });

      const b64 = result.data[0].b64_json;
      return `data:image/png;base64,${b64}`;
    };

    try {
      const dataUrl = await attemptGeneration();
      dataUrls.push(dataUrl);
      console.log(`[imageService] Image ${i + 1}/${prompts.length} generated.`);
    } catch (err) {
      if (err.status === 429) {
        console.log(`[imageService] Rate limited on image ${i + 1}, waiting 15s...`);
        await delay(15000);
        try {
          const dataUrl = await attemptGeneration();
          dataUrls.push(dataUrl);
          console.log(`[imageService] Image ${i + 1}/${prompts.length} generated after retry.`);
        } catch (retryErr) {
          console.error(`[imageService] Retry failed for image ${i + 1}:`, retryErr.message);
          throw retryErr;
        }
      } else {
        console.error(`[imageService] Error on image ${i + 1}:`, err.status || '', err.message);
        throw err;
      }
    }

    // 1s delay between sequential calls (except after the last image)
    if (i < prompts.length - 1) {
      await delay(1000);
    }
  }

  return dataUrls;
}

module.exports = { generateProductImages };
