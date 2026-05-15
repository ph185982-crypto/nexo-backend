const OpenAI = require('openai');

/**
 * Builds the 6 DALL-E 3 prompts based on product analysis from GPT-4o.
 */
function buildImagePrompts(optimizedTitle, productCategory, keywords) {
  const keywordList = keywords.join(', ');
  const subject = `${productCategory}: ${optimizedTitle}`;

  return [
    // 1 — Principal (white background, professional e-commerce)
    `Professional e-commerce product photo of ${subject}. Pure white background (#FFFFFF), studio lighting with soft shadows, sharp focus, product perfectly centered, no text, no watermarks, no logos, photorealistic, high-resolution marketplace photography`,

    // 2 — Lifestyle (real-life use context)
    `Lifestyle photo of ${subject} being used naturally in real life. Bright, natural lighting, beautiful modern environment, person interacting with product in an aspirational way. No text overlays. Photorealistic, warm tones, high quality editorial photography`,

    // 3 — Close-up / Details
    `Close-up macro detail shot of ${subject} showcasing premium quality and key features. Sharp focus on texture and craftsmanship, neutral light background. Highlights: ${keywordList}. No text, photorealistic product photography`,

    // 4 — Benefits / Infographic style
    `Clean minimalist product showcase of ${subject} with visual benefit elements. Light pastel background, modern flat-lay or 3D style arrangement highlighting advantages. Professional, contemporary design, no text labels, visually compelling`,

    // 5 — Vibrant colored background (Shopee style)
    `${subject} on a vibrant, bold gradient background in coral-orange and red tones. Dynamic composition, eye-catching marketplace style. High contrast, product sharply lit, no text, professional product photography for e-commerce`,

    // 6 — Packaging / unboxing
    `Product packaging and unboxing presentation of ${subject}. Clean white or light neutral background. Neatly arranged product next to its box or packaging. Professional, trustworthy e-commerce presentation, no text, photorealistic`,
  ];
}

/**
 * Generates all 6 product images in parallel using DALL-E 3.
 * Returns an array of 6 image URLs.
 */
async function generateProductImages(optimizedTitle, productCategory, keywords, apiKey) {
  const client = new OpenAI({ apiKey });
  const prompts = buildImagePrompts(optimizedTitle, productCategory, keywords);

  const imageRequests = prompts.map((prompt) =>
    client.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    })
  );

  // Generate all 6 images concurrently
  const results = await Promise.all(imageRequests);
  return results.map((result) => result.data[0].url);
}

module.exports = { generateProductImages };
