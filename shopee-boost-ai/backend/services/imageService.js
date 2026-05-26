const OpenAI = require('openai');

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Builds 6 expert-level prompts for gpt-image-1 marketplace product photography.
 */
function buildImagePrompts(optimizedTitle, productCategory, keywords) {
  const product = optimizedTitle.length > 80
    ? optimizedTitle.substring(0, 80)
    : optimizedTitle;

  return [
    // 1 — Principal: hero shot, white bg
    `Commercial product photography: ${product} (${productCategory}). ` +
    `Pure white seamless background, 3-point studio lighting with large softboxes, subtle drop shadow for grounding, ` +
    `product centered filling 80% of frame, shot at f/8, tack-sharp focus throughout, ` +
    `no text, no watermarks, no logos, no people. Photorealistic, ultra-high resolution. ` +
    `Style: Shopee/Amazon hero image standard, clean professional e-commerce photo.`,

    // 2 — Lifestyle: aspirational real-world use
    `Aspirational lifestyle advertising photograph featuring ${product} being used naturally in real life. ` +
    `Beautiful modern interior or relevant outdoor setting, golden hour or soft window light, ` +
    `shallow depth of field, warm color grading, candid and authentic feel. ` +
    `Person interacting with product naturally. ` +
    `No text overlays. Commercial editorial photography, magazine-quality, photorealistic.`,

    // 3 — Detail / close-up
    `Extreme close-up macro product photography of ${product} (${productCategory}) ` +
    `highlighting premium material quality, texture and craftsmanship details. ` +
    `Diffused studio lighting revealing every surface detail, neutral gray background, ` +
    `ultra-sharp focus on key features. Key features: ${keywords.slice(0, 3).join(', ')}. ` +
    `No text. Commercial macro product photography, photorealistic.`,

    // 4 — Flat-lay / top-down
    `Top-down flat-lay commercial photography of ${product} (${productCategory}) ` +
    `artfully arranged on a clean white marble or light pastel background. ` +
    `Even overhead studio lighting, styled with minimal complementary props. ` +
    `Bird's eye view, perfectly composed, geometric arrangement. ` +
    `No text labels. Pinterest and Instagram commercial style, photorealistic.`,

    // 5 — Vibrant Shopee style
    `Bold vibrant commercial product advertising photo of ${product} (${productCategory}). ` +
    `Vivid coral-orange gradient background matching Shopee brand colors, ` +
    `dramatic 3/4 angle composition, cinematic side rim lighting making product pop, ` +
    `high contrast, saturated commercial colors, dynamic eye-catching composition. ` +
    `No text. Marketplace advertising style, photorealistic.`,

    // 6 — Packaging / unboxing
    `Professional product packaging and complete unboxing display of ${product} (${productCategory}). ` +
    `Clean white background, all included items and accessories neatly arranged in flat-lay, ` +
    `original packaging box prominently displayed open beside product, ` +
    `even studio lighting showing every component clearly. ` +
    `Organized, trustworthy e-commerce unboxing style. No text, photorealistic.`,
  ];
}

/**
 * Generates 6 product images sequentially using gpt-image-1.
 * Returns base64 data URLs so images never expire.
 */
async function generateProductImages(optimizedTitle, productCategory, keywords, apiKey) {
  const client = new OpenAI({ apiKey });
  const prompts = buildImagePrompts(optimizedTitle, productCategory, keywords);
  const dataUrls = [];

  for (let i = 0; i < prompts.length; i++) {
    try {
      const result = await client.images.generate({
        model: 'gpt-image-1',
        prompt: prompts[i],
        n: 1,
        size: '1024x1024',
        quality: 'medium',
      });

      const b64 = result.data[0].b64_json;
      dataUrls.push(`data:image/png;base64,${b64}`);

    } catch (err) {
      if (err.status === 429) {
        console.log(`[imageService] Rate limited on image ${i + 1}, waiting 15s...`);
        await delay(15000);
        const retry = await client.images.generate({
          model: 'gpt-image-1',
          prompt: prompts[i],
          n: 1,
          size: '1024x1024',
          quality: 'medium',
        });
        const b64 = retry.data[0].b64_json;
        dataUrls.push(`data:image/png;base64,${b64}`);
      } else {
        throw err;
      }
    }

    if (i < prompts.length - 1) {
      await delay(1000);
    }
  }

  return dataUrls;
}

module.exports = { generateProductImages };
