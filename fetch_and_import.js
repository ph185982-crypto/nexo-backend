/**
 * NEXO Hot Miner v3 — Scan Inicial Local
 * Critérios campeões: ≤$15, markup dinâmico, score ≥75
 * Scoring: Markup(30) + BR Status(25) + Comissão(20) + Rating(15) + Tendência(10)
 * Tradução: MyMemory (Gemini como futura opção)
 * Uso: node fetch_and_import.js
 */
const https = require('https');
const fs    = require('fs');

const RAPIDAPI_KEY  = 'bfa0201ad4msh4eb2fb783613e2fp1f18b7jsn0379d6db7632';
const RAPIDAPI_HOST = 'aliexpress-true-api.p.rapidapi.com';
const NEXO_API      = 'nexo-backend-tjoj.onrender.com';
const TOKEN         = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0Yzc0MTU2MS1kOTBiLTQ2NTItOTFjOS1mYWE2Y2E1M2UwZTMiLCJlbWFpbCI6ImFkbWluQG5leG8uY29tIiwiZXhwIjoxNzczNTQzODY1fQ.4PiS7hkQKZXDfhOoypY-_uJ6LVB3jn3I9bf7pvxXFmg';
const USD_BRL       = 6.10;
const FREIGHT_BRL   = 25.0;
const TAX_RATE      = 0.20;
const MAX_COST_USD  = 15.0;
const MIN_SCORE     = 75;

// Nichos prioritários: [category_id, nome, keyword_ML]
const CATEGORIES = [
  [66,    'Saúde e Beleza',   'massageador skincare escova'],
  [7294,  'Saúde e Beleza',   'led facial cuidados pele'],
  [13,    'Casa Inteligente', 'organizador gadget cozinha'],
  [1503,  'Casa Inteligente', 'limpeza casa inteligente'],
  [15,    'Pet',              'brinquedo gato cama pet'],
  [18,    'Fitness em Casa',  'elastico musculacao tapete yoga'],
  [1501,  'Bebês e Crianças', 'monitor bebe mordedor educativo'],
  [44,    'Eletrônicos',      'carregador magnetico suporte celular'],
  [4,     'Cozinha',          'cortador legumes forma silicone'],
];

// ── Helpers HTTP ──────────────────────────────────────────────────────────────

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const p = new URL(url);
    let data = '';
    const req = https.get({ hostname: p.hostname, path: p.pathname + p.search, headers, timeout: 25000 }, res => {
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('JSON: ' + data.slice(0, 200))); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function post(hostname, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const opts = {
      hostname, path, method: 'POST', timeout: 120000,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Content-Length': Buffer.byteLength(bodyStr) },
    };
    let data = '';
    const req = https.request(opts, res => {
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('JSON: ' + data.slice(0, 200))); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(bodyStr); req.end();
  });
}

// ── Scoring v3 ───────────────────────────────────────────────────────────────

function dynamicMarkup(priceUsd) {
  if (priceUsd <= 3)  return 6.0;
  if (priceUsd <= 5)  return 5.5;
  if (priceUsd <= 8)  return 5.0;
  if (priceUsd <= 12) return 4.0;
  return 3.5;
}

function computeScore(markup, brStatus, commission, rating, discount) {
  // Markup (30 pts)
  const markupPts = markup > 5 ? 30 : markup >= 3.5 ? 20 : 5;
  // Status BR (25 pts) — default "Não Vendido" no scan local
  const brPts = brStatus === 'Não Vendido' ? 25 : brStatus === 'Pouco Vendido' ? 15 : 5;
  // Comissão proxy volume (20 pts)
  const volPts = commission >= 20 ? 20 : commission >= 8 ? 10 : commission >= 5 ? 5 : 0;
  // Rating (15 pts): 94% = 4.7 estrelas, 90% = 4.5
  const ratPts = rating >= 94 ? 15 : rating >= 90 ? 10 : rating >= 80 ? 5 : 0;
  // Tendência / produto novo (10 pts) — todos são is_new no scan inicial
  const trendPts = 10;
  return Math.min(100, markupPts + brPts + volPts + ratPts + trendPts);
}

// ── Mapeamento de produto ─────────────────────────────────────────────────────

function mapProduct(r, catName, mlKeyword) {
  const priceUsd = parseFloat(r.target_sale_price || r.app_sale_price || 0);
  if (priceUsd <= 0 || priceUsd > MAX_COST_USD) return null;

  const discount   = parseFloat((r.discount || '0%').replace('%', '')) || 0;
  const commission = parseFloat(r.hot_product_commission_rate || r.commission_rate || 0) || 0;
  const rating     = parseFloat((r.evaluate_rate || '0').toString().replace('%', '')) || 0;

  const markup      = dynamicMarkup(priceUsd);
  const score       = computeScore(markup, 'Não Vendido', commission, rating, discount);
  if (score < MIN_SCORE) return null;

  const costBrl   = Math.round(priceUsd * USD_BRL * 100) / 100;
  const taxBrl    = Math.round(costBrl * TAX_RATE * 100) / 100;
  const totalCost = Math.round((costBrl + FREIGHT_BRL + taxBrl) * 100) / 100;
  const sellPrice = Math.round(totalCost * markup * 100) / 100;
  const marginPct = Math.round(((sellPrice - totalCost) / sellPrice) * 1000) / 10;

  const smallImgs = ((r.product_small_image_urls || {}).product_small_image_url || []);
  const allImgs   = [r.product_main_image_url, ...smallImgs.filter(x => x && x !== r.product_main_image_url)].filter(Boolean);
  const growth    = '+' + Math.min(999, Math.round(commission * 10)) + '%';
  const kws       = (r.product_title || '').split(' ').slice(0, 5).join(' ');

  return {
    product_id:           String(r.product_id || Math.random()),
    title:                r.product_title || 'Produto',
    title_en:             r.product_title || 'Produto',
    platform:             'aliexpress',
    category:             catName,
    ml_keyword:           mlKeyword,
    price_usd:            priceUsd,
    cost_brl:             costBrl,
    freight_brl:          FREIGHT_BRL,
    tax_brl:              taxBrl,
    total_cost_brl:       totalCost,
    suggested_sell_price: sellPrice,
    markup,
    margin_pct:           marginPct,
    orders_count:         parseInt(r.lastest_volume || 0),
    rating,
    commission_rate:      commission,
    br_status:            'Não Vendido',
    score,
    growth,
    images:               allImgs,
    sources:              [{ name: 'AliExpress', url: r.product_detail_url || '', price: '$' + priceUsd.toFixed(2) }],
    product_url:          r.promotion_link || r.product_detail_url || '',
    supplier_name:        r.shop_name || '',
    is_hot:               commission >= 15 || discount >= 30,
    is_viral:             commission >= 20 || discount >= 40,
    is_new:               true,
    fb_ads_url:           'https://www.facebook.com/ads/library/?q=' + encodeURIComponent(kws) + '&search_type=keyword_unordered&media_type=all&active_status=all&countries[0]=BR',
    tags:                 [catName, r.second_level_category_name || ''].filter(Boolean),
  };
}

// ── Fetch por categoria ───────────────────────────────────────────────────────

async function fetchCategory(catId, catName, mlKeyword) {
  const url = `https://${RAPIDAPI_HOST}/api/v3/hot-products-download?category_id=${catId}&page_no=1&page_size=20&target_currency=USD&target_language=EN&country=TH`;
  try {
    const data   = await get(url, { 'x-rapidapi-host': RAPIDAPI_HOST, 'x-rapidapi-key': RAPIDAPI_KEY });
    if (data.message) { console.error(`  [${catName}] API: ${data.message}`); return []; }
    const raw    = (data.products || {}).product || [];
    const mapped = raw.map(r => mapProduct(r, catName, mlKeyword)).filter(Boolean);
    console.log(`  [${catName}] ${raw.length} brutos → ${mapped.length} aprovados (score≥${MIN_SCORE})`);
    return mapped;
  } catch(e) {
    console.error(`  [${catName}] Erro: ${e.message}`);
    return [];
  }
}

// ── Tradução MyMemory ─────────────────────────────────────────────────────────

function translateOne(text) {
  return new Promise(resolve => {
    const q   = encodeURIComponent(text.split(' ').slice(0, 12).join(' '));
    const url = new URL(`https://api.mymemory.translated.net/get?q=${q}&langpair=en|pt-BR`);
    let data  = '';
    const req = https.get({ hostname: url.hostname, path: url.pathname + url.search, timeout: 10000 }, r => {
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const d  = JSON.parse(data);
          const tr = d?.responseData?.translatedText || '';
          resolve(tr && !tr.includes('MYMEMORY WARNING') ? tr : text);
        } catch { resolve(text); }
      });
    });
    req.on('error', () => resolve(text));
    req.on('timeout', () => { req.destroy(); resolve(text); });
  });
}

async function translateTitles(products) {
  console.log(`\nTraduzindo ${products.length} títulos para PT-BR via MyMemory...`);
  let ok = 0;
  for (let i = 0; i < products.length; i++) {
    const pt = await translateOne(products[i].title_en);
    if (pt && pt !== products[i].title_en) { products[i].title = pt; ok++; }
    await new Promise(r => setTimeout(r, 120));
    if ((i + 1) % 10 === 0) process.stdout.write(`  ${i+1}/${products.length}... `);
  }
  console.log(`\n  OK: ${ok}/${products.length} traduzidos`);
  return products;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════╗');
  console.log('║   NEXO Hot Miner v3 — Scan Inicial ║');
  console.log('╚══════════════════════════════════╝');
  console.log(`Critérios: ≤$${MAX_COST_USD} | markup dinâmico 3.5x–6x | score≥${MIN_SCORE}/100\n`);

  const all = [];
  for (const [catId, catName, mlKw] of CATEGORIES) {
    const products = await fetchCategory(catId, catName, mlKw);
    all.push(...products);
    await new Promise(r => setTimeout(r, 500));
  }

  // Deduplica e ordena
  const seen = new Set();
  let unique = all
    .filter(p => { if (seen.has(p.product_id)) return false; seen.add(p.product_id); return true; })
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  console.log(`\n┌─────────────────────────────────────┐`);
  console.log(`│  ${unique.length} produtos aprovados pelos critérios  │`);
  console.log(`└─────────────────────────────────────┘`);

  if (!unique.length) { console.error('Nenhum produto passou. Verificar filtros.'); process.exit(1); }

  // Top 3 preview
  console.log('\nTOP 3 PRODUTOS:');
  unique.slice(0, 3).forEach((p, i) => {
    console.log(`  ${i+1}. Score ${p.score}/100 | R$${p.suggested_sell_price} (${p.markup}x) | ${p.category}`);
    console.log(`     ${p.title.slice(0, 70)}`);
    console.log(`     Img: ${(p.images[0]||'').slice(0, 65)}`);
  });

  // Traduz títulos
  unique = await translateTitles(unique);
  console.log(`\n  Amostra PT: "${unique[0].title.slice(0, 65)}"`);

  // Salva local
  fs.writeFileSync('C:/Users/ph185/Downloads/ali_products_collected.json', JSON.stringify(unique, null, 2));
  console.log('\nSalvo em ali_products_collected.json');

  // Importa no backend
  console.log('Importando no backend NEXO...');
  const result = await post(NEXO_API, '/api/mining/import', { products: unique, clear: true }, TOKEN);
  console.log(`\n✅ IMPORTAÇÃO: ${JSON.stringify(result)}`);
  return unique.length;
}

main()
  .then(n => {
    console.log(`\n✅ Scan inicial concluído: ${n} produtos campeões na plataforma.`);
    process.exit(0);
  })
  .catch(e => { console.error('\n❌ ERRO:', e.message); process.exit(1); });
