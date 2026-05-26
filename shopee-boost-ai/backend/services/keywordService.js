/**
 * keywordService.js
 *
 * Uses the Shopee Scraper RapidAPI to find real Shopee search keywords.
 * Graceful fallback: returns empty array on any failure so GPT-4o keywords are used instead.
 */

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '8ddafbfb15msh2e32891dc8bea9ap195412jsnd1eb446d3f32';
const RAPIDAPI_HOST = 'shopee-scraper1.p.rapidapi.com';
const SCRAPER_ENDPOINT = 'https://shopee-scraper1.p.rapidapi.com/';

/**
 * Calls the Shopee Scraper RapidAPI with a given Shopee URL.
 * Returns the raw parsed JSON body or null on failure.
 *
 * @param {string} shopeeUrl - The Shopee API URL to scrape
 * @returns {Promise<any|null>}
 */
async function callScraper(shopeeUrl) {
  try {
    const response = await fetch(SCRAPER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST,
      },
      body: JSON.stringify({ url: shopeeUrl }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`[keywordService] Scraper responded with status ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.warn('[keywordService] callScraper error:', err.message);
    return null;
  }
}

/**
 * Extracts keyword strings from a scraper response object.
 * Handles various response shapes the API might return.
 *
 * @param {any} data - Parsed JSON response from the scraper
 * @returns {string[]}
 */
function extractKeywords(data) {
  if (!data || typeof data !== 'object') return [];

  const keywords = new Set();

  // Shape 1: data.result.data[].keyword (trending search)
  try {
    if (Array.isArray(data.result?.data)) {
      for (const item of data.result.data) {
        if (item.keyword && typeof item.keyword === 'string') {
          keywords.add(item.keyword.trim());
        }
      }
    }
  } catch (_) {}

  // Shape 2: data.items[].name (search results)
  try {
    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        if (item.name && typeof item.name === 'string') {
          const kw = item.name.trim().split(/\s+/).slice(0, 6).join(' ');
          if (kw.length > 0) keywords.add(kw);
        }
      }
    }
  } catch (_) {}

  // Shape 3: data.data.items[].item_basic.name
  try {
    if (Array.isArray(data.data?.items)) {
      for (const item of data.data.items) {
        const name = item.item_basic?.name || item.name;
        if (name && typeof name === 'string') {
          const kw = name.trim().split(/\s+/).slice(0, 6).join(' ');
          if (kw.length > 0) keywords.add(kw);
        }
      }
    }
  } catch (_) {}

  // Shape 4: data.data.keyword_list[].keyword (trending keywords)
  try {
    if (Array.isArray(data.data?.keyword_list)) {
      for (const entry of data.data.keyword_list) {
        const kw = entry?.keyword || entry?.name;
        if (kw && typeof kw === 'string') keywords.add(kw.trim());
      }
    }
  } catch (_) {}

  // Shape 5: data[].keyword or data[].name (flat array)
  try {
    if (Array.isArray(data)) {
      for (const item of data) {
        const kw = item.keyword || item.name || item.term;
        if (kw && typeof kw === 'string') {
          keywords.add(kw.trim().split(/\s+/).slice(0, 6).join(' '));
        }
      }
    }
  } catch (_) {}

  return Array.from(keywords).filter((k) => k.length > 0);
}

/**
 * Searches for real Shopee search keywords related to a product title.
 * Tries the Shopee search items API first via the scraper.
 * Returns up to 10 keyword strings, or empty array on any failure.
 *
 * @param {string} productTitle - The product title to search for
 * @returns {Promise<string[]>}
 */
async function searchShopeeKeywords(productTitle) {
  if (!productTitle || typeof productTitle !== 'string' || productTitle.trim().length === 0) {
    return [];
  }

  const q = encodeURIComponent(productTitle.trim());

  try {
    // Attempt 1: Shopee search_items endpoint
    const searchUrl = `https://shopee.com.br/api/v4/search/search_items?keyword=${q}&limit=10&newest=0&order=relevancy`;
    console.log(`[keywordService] Trying search_items for: "${productTitle}"`);

    const searchData = await callScraper(searchUrl);
    if (searchData) {
      const keywords = extractKeywords(searchData);
      if (keywords.length > 0) {
        const result = keywords.slice(0, 10);
        console.log(`[keywordService] Got ${result.length} keywords from search_items.`);
        return result;
      }
    }

    // All attempts failed — return empty array (GPT-4o keywords will be used)
    console.log('[keywordService] No keywords extracted — using GPT-4o fallback.');
    return [];
  } catch (err) {
    console.warn('[keywordService] Unexpected error, returning empty array:', err.message);
    return [];
  }
}

module.exports = { searchShopeeKeywords };
