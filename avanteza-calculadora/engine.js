/* All monetary values in this module are integer cents. */
(function (root) {
  'use strict';
  const defaults = {
    marketplace: 'shopee', mode: 'suggest', cost: 3000, packaging: 200,
    shipping: 1200, shippingMode: 'estimate', weight: 'light', tax: 4,
    ads: 0, extra: 0, target: 20, price: 9990, mlPlan: 'classic',
    amazonPlan: 'individual', category: 'general', installments: false,
    custom: false, commission: 16, fixed: 0, tiktokSfp: true
  };
  const names = {shopee:'Shopee', ml:'Mercado Livre', amazon:'Amazon', magalu:'Magalu', tiktok:'TikTok Shop', other:'Outro marketplace'};
  const amazonCategories = {
    general: {label:'Demais categorias', rate:15, min:200},
    clothing: {label:'Roupas e acessórios', rate:14, min:200},
    home: {label:'Casa', rate:12, min:200},
    tools: {label:'Ferramentas e construção', rate:11, min:200},
    beauty: {label:'Beleza', rate:13, min:200},
    electronics: {label:'Eletrônicos portáteis', rate:13, min:200},
    books: {label:'Livros', rate:15, min:200},
    accessories: {label:'Acessórios para eletrônicos e PC', rate:15, min:200, threshold:10000},
    furniture: {label:'Móveis', rate:15, min:200, threshold:20000}
  };
  function fees(s, p) {
    let rate = 0, fixed = 0, commission = 0, service = 0;
    if (s.custom || s.marketplace === 'other') {
      rate = s.commission; fixed = s.fixed; commission = Math.round(p * rate / 100);
    } else if (s.marketplace === 'shopee') {
      rate = p < 8000 ? 20 : 14;
      fixed = p < 900 ? Math.round(p / 2) : p < 8000 ? 450 : p < 10000 ? 1600 : p < 20000 ? 2000 : 2600;
      commission = Math.round(p * rate / 100);
    } else if (s.marketplace === 'ml') {
      rate = s.mlPlan === 'premium' ? 17 : 12;
      commission = Math.round(p * rate / 100);
    } else if (s.marketplace === 'amazon') {
      const c = amazonCategories[s.category] || amazonCategories.general;
      rate = c.rate;
      commission = Math.max(c.min, Math.round(c.threshold && p > c.threshold ? c.threshold * rate / 100 + (p - c.threshold) * .10 : p * rate / 100));
      if (s.installments && p >= 4000) commission += Math.round(p * .015);
      fixed = s.amazonPlan === 'individual' ? 200 : 0;
    } else if (s.marketplace === 'magalu') {
      rate = 18; commission = Math.round(p * rate / 100);
    } else if (s.marketplace === 'tiktok') {
      rate = p < 5000 ? 10 : 6; fixed = p < 5000 ? 400 : 600;
      commission = Math.round(p * rate / 100);
    }
    if (s.marketplace === 'tiktok' && s.tiktokSfp) service = Math.min(5000, Math.round(p * .06));
    return {rate, commission, fixed, service};
  }
  function breakdown(s, p) {
    const f = fees(s, p);
    const shipping = s.shippingMode === 'covered' ? 0 : s.shipping;
    const tax = Math.round(p * s.tax / 100), ads = Math.round(p * s.ads / 100);
    const total = s.cost + s.packaging + shipping + s.extra + f.commission + f.fixed + f.service + tax + ads;
    const profit = p - total;
    return {...f, price:p, shipping, tax, ads, total, profit, margin:p > 0 ? profit / p * 100 : 0, payout:p - f.commission - f.fixed - f.service - shipping};
  }
  function validate(s) {
    for (const key of ['cost','packaging','shipping','extra',...(s.mode === 'check' ? ['price'] : []),...(s.custom || s.marketplace === 'other' ? ['fixed'] : [])]) {
      if (!Number.isFinite(s[key]) || s[key] < 0 || s[key] > 1000000000) return 'Revise os valores: use números a partir de zero e até R$ 10 milhões.';
    }
    for (const key of ['target','tax','ads',...(s.custom || s.marketplace === 'other' ? ['commission'] : [])]) {
      if (!Number.isFinite(s[key]) || s[key] < 0 || s[key] >= 100) return 'As porcentagens precisam estar entre 0 e 99,99%.';
      if (Math.abs(s[key] * 100 - Math.round(s[key] * 100)) > 1e-7) return 'Use no máximo duas casas decimais nas porcentagens.';
    }
    if (s.mode === 'check' && s.price < 1) return 'Informe um preço de venda maior que zero.';
    return '';
  }
  function suggest(s, target = s.target) {
    // Within a tariff band the unrounded cost is linear. Rounding the individual
    // charges changes it by at most two cents. Search only that bounded root
    // neighborhood, in order, to retain exact cent-level minimums even when
    // a narrow margin causes rounding to make profit locally nonmonotonic.
    const cuts = [1,900,4000,8000,10000,20000,1000000001];
    if (s.marketplace === 'tiktok') cuts.push(5000,83334);
    if (s.marketplace === 'amazon' && !s.custom) {
      const c = amazonCategories[s.category] || amazonCategories.general;
      cuts.push(Math.ceil(c.min * 100 / c.rate));
    }
    const ordered=[...new Set(cuts)].sort((a,b)=>a-b);
    const qualifies = p => breakdown(s,p).profit + 1e-8 >= p * target / 100;
    for (let i=0;i<ordered.length-1;i++) {
      const lower=ordered[i], upper=ordered[i+1]-1;
      const at=rawCosts(s,lower), slope=1-at.rate-target/100;
      const constant=at.fixed;
      let start=lower, end=upper;
      if (slope > 1e-10) {
        start=Math.max(lower,Math.ceil((constant-2.001)/slope));
        end=Math.min(upper,Math.ceil((constant+2.001)/slope));
      } else if (slope < -1e-10) {
        end=Math.min(upper,Math.floor((constant-2.001)/slope));
      } else {
        if (constant > 2.001) continue;
        // Percentages have at most two decimal places, so at zero slope
        // the exact rounding pattern repeats every 10,000 cents.
        end=Math.min(upper,lower+10000);
      }
      for (let p=start;p<=end;p++) if (qualifies(p)) return p;
    }
    return null;
  }
  function rawCosts(s,p) {
    let rate=(s.tax+s.ads)/100, fixed=s.cost+s.packaging+s.extra+(s.shippingMode==='covered'?0:s.shipping);
    if(s.custom||s.marketplace==='other'){rate+=s.commission/100;fixed+=s.fixed;}
    else if(s.marketplace==='shopee'){
      rate+=p<8000?.20:.14;
      if(p<900)rate+=.5;else fixed+=p<8000?450:p<10000?1600:p<20000?2000:2600;
    } else if(s.marketplace==='ml')rate+=s.mlPlan==='premium'?.17:.12;
    else if(s.marketplace==='magalu')rate+=.18;
    else if(s.marketplace==='tiktok'){rate+=p<5000?.10:.06;fixed+=p<5000?400:600;}
    else if(s.marketplace==='amazon'){
      const c=amazonCategories[s.category]||amazonCategories.general;
      if(p*c.rate/100<c.min)fixed+=c.min;
      else if(c.threshold&&p>=c.threshold){rate+=.10;fixed+=c.threshold*(c.rate/100-.10);}
      else rate+=c.rate/100;
      if(s.installments&&p>=4000)rate+=.015;
      if(s.amazonPlan==='individual')fixed+=200;
    }
    if(s.marketplace==='tiktok'&&s.tiktokSfp){if(p<83334)rate+=.06;else fixed+=5000;}
    return {rate,fixed};
  }
  function parseMoney(raw) {
    let v=String(raw).trim().replace(/R\$/g,'').replace(/\s/g,'');
    if (!v) return NaN;
    if (v.includes(',')) v=v.replace(/\./g,'').replace(',','.');
    if (!/^-?\d+(\.\d{0,2})?$/.test(v)) return NaN;
    return Math.round(Number(v)*100);
  }
  const api = {defaults,names,amazonCategories,fees,breakdown,validate,suggest,parseMoney};
  root.AvantezaEngine=api;
  if (typeof module !== 'undefined') module.exports=api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
