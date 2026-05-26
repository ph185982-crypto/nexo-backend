const OpenAI = require('openai');

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Builds 6 expert-level DALL-E 3 prompts for marketplace product photography.
 * Prompts use professional photography terminology to maximize image quality.
 */
function buildImagePrompts(optimizedTitle, productCategory, keywords) {
  const product = optimizedTitle.length > 80
    ? optimizedTitle.substring(0, 80)
    : optimizedTitle;

  return [
    // 1 — Principal: hero shot, white bg, e-commerce standard
    `Professional commercial product photography: ${product} (${productCategory}). ` +
    `Pure white seamless background, 3-point studio lighting with large softboxes, subtle drop shadow for grounding, ` +
    `product centered and filling 80% of frame, shot at f/8 with 85mm lens, tack-sharp focus, ` +
    `no text, no watermarks, no logos, no people. Photorealistic, ultra-high resolution. ` +
    `Style: Amazon/Shopee hero image standard, clean professional e-commerce photo.`,

    // 2 — Lifestyle: aspirational real-world use
    `Aspirational lifestyle advertising photograph featuring ${product} being used naturally in real life. ` +
    `Beautiful modern interior or relevant outdoor setting, golden hour or soft window light, ` +
    `shallow depth of field (f/2.8), warm color grading, candid and authentic feel. ` +
    `Person interacting with product naturally, hands or body partially visible to show scale. ` +
    `No text overlays. Commercial editorial photography, magazine-quality, photorealistic.`,

    // 3 — Detail / close-up: material quality and craftsmanship
    `Extreme close-up macro product photography of ${product} (${productCategory}) ` +
    `highlighting premium material quality, texture and craftsmanship details. ` +
    `f/11 aperture for full depth of field, diffused studio lighting revealing every surface detail, ` +
    `neutral light gray background, ultra-sharp focus on key feature or texture. ` +
    `Key features shown: ${keywords.slice(0, 3).join(', ')}. ` +
    `No text. Commercial macro product photography, photorealistic.`,

    // 4 — Flat-lay / benefits: styled top-down composition
    `Top-down flat-lay commercial photography of ${product} (${productCategory}) ` +
    `artfully arranged on a clean white marble or light background. ` +
    `Even overhead studio lighting, styled with minimal complementary props that suggest the use context. ` +
    `Bird's eye view, perfectly composed, geometric arrangement. ` +
    `No text labels. Pinterest and Instagram commercial style, photorealistic.`,

    // 5 — Vibrant: bold marketplace hero image
    `Bold vibrant commercial product advertising photo of ${product} (${productCategory}). ` +
    `Vivid coral-orange gradient background (Shopee brand colors), ` +
    `dramatic 3/4 angle composition, cinematic side rim lighting making product pop, ` +
    `high contrast, saturated commercial colors, dynamic and eye-catching composition. ` +
    `No text. Marketplace advertising style, commercial product photography, photorealistic.`,

    // 6 — Packaging / unboxing: trust and completeness
    `Professional product packaging and complete unboxing display of ${product} (${productCategory}). ` +
    `Clean white background, all included items and accessories neatly arranged in a flat-lay, ` +
    `original packaging box prominently displayed open beside product, ` +
    `even studio lighting showing every component clearly. ` +
    `Organized, trustworthy, e-commerce unboxing style. No text, photorealistic.`,
  ];
}

/**
 * Generates 6 product images sequentially to respect DALL-E 3 rate limits.
 * Returns an array of 6 image URLs.
 */
async function generateProductImages(optimizedTitle, productCategory, keywords, apiKey) {
  const client = new OpenAI({ apiKey });
  const prompts = buildImagePrompts(optimizedTitle, productCategory, keywords);
  const urls = [];

  for (let i = 0; i < prompts.length; i++) {
    try {
      const result = await client.images.generate({
        model: 'dall-e-3',
        prompt: prompts[i],
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      });
      urls.push(result.data[0].url);
    } catch (err) {
      // On rate limit, wait and retry once
      if (err.status === 429) {
        console.log(`[imageService] Rate limited on image ${i + 1}, waiting 15s...`);
        await delay(15000);
        const retry = await client.images.generate({
          model: 'dall-e-3',
          prompt: prompts[i],
          n: 1,
          size: '1024x1024',
          quality: 'standard',
        });
        urls.push(retry.data[0].url);
      } else {
        throw err;
      }
    }

    // 1.5s gap between requests to stay within rate limits
    if (i < prompts.length - 1) {
      await delay(1500);
    }
  }

  return urls;
}

module.exports = { generateProductImages };
