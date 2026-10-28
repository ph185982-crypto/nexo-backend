(function () {
  'use strict';
  const E=window.AvantezaEngine, $=id=>document.getElementById(id);
  const money=n=>Number.isFinite(n)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100):'—';
  const decimal=(n,d=2)=>Number(n).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
  const percentage=n=>decimal(n,1)+'%';
  let state={...E.defaults}, output=null, toastTimer;
  try {const saved=JSON.parse(localStorage.getItem('avanteza-calculator-v1'));if(saved&&typeof saved==='object'&&Object.hasOwn(E.names,saved.marketplace)&&!E.validate({...state,...saved}))state={...state,...saved};} catch{}
  for(const [id,c] of Object.entries(E.amazonCategories)){const option=document.createElement('option');option.value=id;option.textContent=c.label;$('category').append(option);}
  const currencyKeys=['cost','packaging','shipping','extra','price','fixed'];
  const percentKeys=['tax','ads','commission'];
  function fieldsFromState(){
    currencyKeys.forEach(k=>$(k).value=decimal(state[k]/100));
    percentKeys.forEach(k=>$(k).value=decimal(state[k],Number.isInteger(state[k])?0:2));
    ['mlPlan','amazonPlan','category','shippingMode','weight','target'].forEach(k=>$(k).value=state[k]);
    $('custom').checked=state.custom;$('installments').checked=state.installments;$('tiktokSfp').checked=state.tiktokSfp;
  }
  function setExpanded(button,panel,open){$(button).setAttribute('aria-expanded',String(open));$(panel).hidden=!open;}
  const hints={
    shopee:'Referência para CNPJ, por faixa de preço. Para CPF, campanhas e adicionais, use suas tarifas do extrato. A tarifa pode mudar quando o preço muda.',
    ml:'Comissão de referência: 12% no Clássico ou 17% no Premium. Ajuste a comissão e os custos por unidade conforme categoria, envio e anúncio. Não há tarifa fixa presumida nesta simulação.',
    amazon:'Comissão da categoria, com mínimo de R$ 2 nas opções disponíveis. Plano Individual soma R$ 2 por item. No Profissional, inclua mensalidade rateada em outros custos. Não inclui FBA/DBA.',
    magalu:'Os 18% são um exemplo editável de comissão. Informe a comissão e a tarifa por item negociadas no seu contrato. Não incluímos incentivos temporários.',
    tiktok:'Referência desde 15/07/2026: abaixo de R$ 50, 10% + R$ 4 por item; a partir de R$ 50, 6% + R$ 6. O programa de frete, quando ativado, é somado à parte. Ajuste tarifas para incentivos da sua loja.',
    other:'Informe a comissão percentual e a tarifa por item do seu marketplace. Você pode simular Shein, OLX ou outro canal com as suas próprias condições.'
  };
  function updateUI(){
    document.querySelectorAll('[data-market]').forEach(b=>{const yes=b.dataset.market===state.marketplace;b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',String(yes));});
    document.querySelectorAll('[data-mode]').forEach(b=>{const yes=b.dataset.mode===state.mode;b.classList.toggle('active',yes);b.setAttribute('aria-selected',String(yes));b.tabIndex=yes?0:-1;});
    $('modeContent').setAttribute('aria-labelledby',state.mode==='suggest'?'suggestTab':'checkTab');
    $('targetFields').hidden=state.mode!=='suggest';$('priceFields').hidden=state.mode!=='check';
    $('goalTitle').textContent=state.mode==='suggest'?'Qual margem você quer ter?':'Por quanto você quer vender?';
    $('channelOptions').hidden=!['ml','amazon','tiktok'].includes(state.marketplace);
    $('mlOptions').hidden=state.marketplace!=='ml';$('amazonOptions').hidden=state.marketplace!=='amazon';
    $('tiktokOptions').hidden=state.marketplace!=='tiktok';$('tiktokSfp').checked=state.tiktokSfp;
    $('channelHelp').textContent=hints[state.marketplace];
    const manual=state.custom||state.marketplace==='other';
    $('commission').disabled=!manual;$('fixed').disabled=!manual;$('custom').disabled=state.marketplace==='other';
    $('custom').checked=manual;
    $('rateExtra').textContent=manual?'Estas tarifas substituem as referências do canal. Inclua adicionais na sua comissão ou tarifa fixa.':'Ative a opção acima para substituir as tarifas automáticas pelas suas.';
    if(manual&&state.marketplace==='tiktok')$('rateExtra').textContent='Estas tarifas substituem a comissão e o fixo. O programa de frete continua somado à parte quando ativado.';
    $('shipping').disabled=state.shippingMode==='covered';$('weight').hidden=state.shippingMode!=='estimate';
    $('shippingBadge').textContent=state.shippingMode==='estimate'?'Reserva estimada':state.shippingMode==='covered'?'Sem custo':'Valor informado';
    $('shippingHelp').textContent=state.shippingMode==='estimate'?'Reserva ilustrativa por peso. Troque pelo custo real do seu anúncio.':state.shippingMode==='covered'?'Use apenas quando você realmente não tiver custo de envio.':'Informe apenas a parcela do frete que sai do seu bolso.';
    $('targetRange').value=Math.min(60,state.target||0);$('targetRange').style.background=`linear-gradient(to right,var(--blue) ${Math.min(100,(state.target||0)/60*100)}%,#e9ebf4 ${Math.min(100,(state.target||0)/60*100)}%)`;
    $('extraBrief').textContent=(Number.isFinite(state.tax)?decimal(state.tax,Number.isInteger(state.tax)?0:1):'—')+'% de imposto';
  }
  function render(){
    updateUI();
    const error=E.validate(state), suggested=!error?E.suggest(state):null;
    const price=state.mode==='suggest'?suggested:state.price;
    const minimum=!error?E.suggest(state,0):null;
    const impossible=state.mode==='suggest'&&suggested===null;
    $('formError').hidden=!error&&!impossible;
    $('formError').textContent=error||(impossible?'Não é possível atingir essa margem até R$ 10 milhões com os custos e percentuais informados. Revise as taxas ou reduza a margem.':'');
    document.querySelector('.price-card').classList.toggle('invalid',!!error||impossible);
    output=!error&&!impossible?E.breakdown(state,price):null;
    $('resultLabel').textContent=state.mode==='suggest'?'SEU PREÇO SUGERIDO':'SEU PREÇO DE VENDA';
    $('resultChannel').textContent=E.names[state.marketplace];
    $('resultPrice').textContent=output?decimal(price/100):'—';
    document.querySelector('.price-display').classList.toggle('long',!!output&&price>=1000000);
    $('resultProfit').textContent=output?money(output.profit):'—';$('resultMargin').textContent=output?percentage(output.margin):'—';
    $('mobileLabel').textContent=state.mode==='suggest'?'Preço sugerido':'Preço de venda';
    $('mobilePrice').textContent=output?money(price):'—';$('mobileProfit').textContent=output?money(output.profit):'—';
    $('mobileSummary').classList.toggle('mobile-loss',!!output&&output.profit<0);
    const preposition=['ml','tiktok'].includes(state.marketplace)?'no':'na';
    $('priceCaption').textContent=error?'Revise os campos destacados para continuar.':impossible?'Esta margem não cabe na conta atual.':state.mode==='suggest'?`Para alcançar sua margem de ${decimal(state.target,Number.isInteger(state.target)?0:1)}% ${preposition} ${E.names[state.marketplace]}.`:`Resultado por unidade vendida ${preposition} ${E.names[state.marketplace]}.`;
    document.querySelector('.price-card').classList.toggle('loss',!!output&&output.profit<0);
    let status='Seu preço, com estratégia.';
    if(output&&output.profit<0)status='Atenção: esse preço gera prejuízo.';
    else if(output&&state.mode==='check')status=output.margin+1e-8>=state.target?`Margem igual ou acima da meta de ${percentage(state.target)}.`:`Abaixo da meta de ${percentage(state.target)}.`;
    else if(!output)status='Ajuste os valores para calcular.';
    $('resultStatus').lastChild.textContent=' '+status;
    const values={outProduct:output?state.cost+state.packaging:NaN,outCommission:output?.commission,outFixed:output?.fixed,outService:output?.service,outShipping:output?.shipping,outTax:output?output.tax+output.ads:NaN,outOther:output?state.extra:NaN,outTotal:output?.total,outMinimum:minimum};
    for(const [id,value] of Object.entries(values))$(id).textContent=value===null?'Não disponível':money(value);
    $('outRate').textContent=output?(state.marketplace==='amazon'&&!state.custom?'(categoria e plano)':`(${decimal(output.rate,Number.isInteger(output.rate)?0:2)}%)`):'';
    $('outShippingType').textContent=state.shippingMode==='estimate'?'estimado':'';
    $('otherRow').hidden=!(state.extra>0);
    $('tiktokServiceRow').hidden=state.marketplace!=='tiktok';
    $('tariffBrief').textContent=(state.custom||state.marketplace==='other')?'Suas tarifas personalizadas':['shopee','tiktok'].includes(state.marketplace)?'Tarifas por faixa de preço':state.marketplace==='ml'?'Comissão de referência por anúncio':state.marketplace==='amazon'?'Tarifas por categoria e plano':'Comissão de referência · ajuste ao contrato';
    $('copySummary').disabled=!output;
    $('distribution').replaceChildren();
    if(output){const parts=[['product',state.cost+state.packaging,'Produto e embalagem'],['fees',output.commission+output.fixed+output.service,'Tarifas'],['shipping',output.shipping,'Frete'],['tax',output.tax+output.ads+state.extra,'Impostos, anúncios e outros'],['profit',Math.max(0,output.profit),'Lucro']];const denominator=Math.max(price,output.total);for(const [className,value,label] of parts){if(value<=0)continue;const span=document.createElement('span');span.className=className;span.style.width=(value/denominator*100)+'%';span.title=label+': '+money(value);$('distribution').append(span);}}
    if(!$('comparison').hidden)renderComparison();
    try{if(!error)localStorage.setItem('avanteza-calculator-v1',JSON.stringify(state));}catch{}
  }
  function renderComparison(){
    $('comparisonGrid').replaceChildren();
    for(const market of ['shopee','ml','amazon','magalu','tiktok']){
      const same=market===state.marketplace;
      const s=same?{...state}:{...state,marketplace:market,custom:false,mlPlan:E.defaults.mlPlan,amazonPlan:E.defaults.amazonPlan,category:E.defaults.category,installments:false,tiktokSfp:E.defaults.tiktokSfp};
      const p=E.validate(s)?null:E.suggest(s),b=p!==null?E.breakdown(s,p):null;
      const card=document.createElement('div');card.className='comparison-card'+(same?' current':'');
      const name=document.createElement('span');name.textContent=E.names[market]+(same?' · selecionado':'');
      const price=document.createElement('strong');price.textContent=p===null?'—':money(p);
      const caption=document.createElement('small');caption.textContent=b?`Lucro: ${money(b.profit)} · ${percentage(b.margin)}`:'Revise custos e percentuais.';
      const tariff=document.createElement('small');tariff.textContent=same?'Condições da sua simulação':market==='amazon'?'Demais categorias · Individual':market==='ml'?'Clássico · referência de 12%':market==='magalu'?'Referência de 18%':market==='tiktok'?'Por faixa · programa de frete ativo':'Referência CNPJ por faixa';
      card.append(name,price,caption,tariff);$('comparisonGrid').append(card);
    }
  }
  function setMoneyField(key){const value=E.parseMoney($(key).value);state[key]=value;$(key).setAttribute('aria-invalid',String(!Number.isFinite(value)||value<0||value>1000000000));if(key==='shipping'&&state.shippingMode==='estimate'){state.shippingMode='manual';$('shippingMode').value='manual';}render();}
  currencyKeys.forEach(key=>{$(key).addEventListener('input',()=>setMoneyField(key));$(key).addEventListener('blur',()=>{if(Number.isFinite(state[key])&&state[key]>=0)$(key).value=decimal(state[key]/100);});});
  percentKeys.forEach(key=>{$(key).addEventListener('input',()=>{const raw=$(key).value.trim().replace(',','.');state[key]=raw===''?NaN:Number(raw);$(key).setAttribute('aria-invalid',String(!Number.isFinite(state[key])||state[key]<0||state[key]>=100));render();});});
  document.querySelectorAll('[data-market]').forEach(b=>b.addEventListener('click',()=>{
    state.marketplace=b.dataset.market;state.custom=state.marketplace==='other';
    const reference=E.fees(state,output?.price||state.price);
    state.commission=state.marketplace==='other'?16:reference.rate;state.fixed=state.marketplace==='other'?0:reference.fixed;
    $('custom').checked=state.custom;$('commission').value=String(state.commission);$('fixed').value=decimal(state.fixed/100);
    ['commission','fixed'].forEach(k=>$(k).removeAttribute('aria-invalid'));
    if(state.marketplace==='other')setExpanded('ratesToggle','rateSettings',true);
    render();
  }));
  document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{state.mode=b.dataset.mode;if(!Number.isFinite(state.target)||state.target<0||state.target>=100){state.target=E.defaults.target;$('target').value=state.target;$('target').removeAttribute('aria-invalid');}render();}));
  document.querySelector('.mode-tabs').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=(event.key==='Home')?'suggest':(event.key==='End')?'check':state.mode==='suggest'?'check':'suggest';document.querySelector(`[data-mode="${next}"]`).click();document.querySelector(`[data-mode="${next}"]`).focus();}});
  $('target').addEventListener('input',()=>{state.target=$('target').value===''?NaN:Number($('target').value);$('target').setAttribute('aria-invalid',String(!Number.isFinite(state.target)||state.target<0||state.target>=100));render();});
  $('targetRange').addEventListener('input',()=>{state.target=Number($('targetRange').value);$('target').value=state.target;$('target').removeAttribute('aria-invalid');render();});
  ['mlPlan','amazonPlan','category'].forEach(k=>$(k).addEventListener('change',()=>{state[k]=$(k).value;render();}));
  $('installments').addEventListener('change',()=>{state.installments=$('installments').checked;render();});
  $('tiktokSfp').addEventListener('change',()=>{state.tiktokSfp=$('tiktokSfp').checked;render();});
  $('custom').addEventListener('change',()=>{if($('custom').checked&&output){state.commission=output.rate;state.fixed=output.fixed;$('commission').value=String(state.commission).replace('.',',');$('fixed').value=decimal(state.fixed/100);['commission','fixed'].forEach(k=>$(k).removeAttribute('aria-invalid'));}state.custom=$('custom').checked;render();});
  function updateEstimate(){state.shipping={light:1200,medium:1800,heavy:2800}[state.weight]||1200;$('shipping').value=decimal(state.shipping/100);$('shipping').removeAttribute('aria-invalid');}
  $('shippingMode').addEventListener('change',()=>{state.shippingMode=$('shippingMode').value;if(state.shippingMode==='estimate')updateEstimate();if(state.shippingMode==='covered'){state.shipping=0;$('shipping').value='0,00';$('shipping').removeAttribute('aria-invalid');}render();});
  $('weight').addEventListener('change',()=>{state.weight=$('weight').value;updateEstimate();render();});
  [['ratesToggle','rateSettings'],['extraToggle','extraSettings'],['compareToggle','comparison']].forEach(([button,panel])=>$(button).addEventListener('click',()=>{setExpanded(button,panel,$(panel).hidden);if(panel==='comparison')renderComparison();}));
  $('calculator').addEventListener('submit',e=>e.preventDefault());
  function toast(message){clearTimeout(toastTimer);$('toast').querySelector('span').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
  $('reset').addEventListener('click',()=>{state={...E.defaults};fieldsFromState();document.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));setExpanded('ratesToggle','rateSettings',false);setExpanded('extraToggle','extraSettings',false);render();toast('Simulação reiniciada com valores de exemplo.');});
  const openDialog=id=>{if(!$(id).open)$(id).showModal();};
  $('howOpen').addEventListener('click',()=>openDialog('helpDialog'));
  $('sourcesOpen').addEventListener('click',()=>openDialog('sourcesDialog'));
  document.querySelectorAll('dialog').forEach(d=>{d.querySelectorAll('.close-dialog,.close-help').forEach(b=>b.addEventListener('click',()=>d.close()));d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});});
  $('copySummary').addEventListener('click',async()=>{
    if(!output)return;
    const b=output;
    const summary=['AVANTEZA | Simulação de marketplace',E.names[state.marketplace],`Preço de venda: ${money(b.price)}`,`Produto: ${money(state.cost)}`,`Embalagem: ${money(state.packaging)}`,`Frete do vendedor: ${money(b.shipping)}${state.shippingMode==='estimate'?' (reserva ilustrativa)':''}`,`Comissão: ${money(b.commission)}`,`Tarifa fixa por item: ${money(b.fixed)}`,...(state.marketplace==='tiktok'?[`Programa de frete TikTok: ${money(b.service)}`]:[]),`Impostos: ${money(b.tax)} (${percentage(state.tax)})`,`Anúncios e afiliados: ${money(b.ads)} (${percentage(state.ads)})`,`Outros custos: ${money(state.extra)}`,`Custo total: ${money(b.total)}`,`Lucro por unidade: ${money(b.profit)}`,`Margem: ${percentage(b.margin)}`,`Preço mínimo: ${$('outMinimum').textContent}`,'','Estimativa com custos informados. Revise tarifas e frete no painel do marketplace.'].join('\n');
    try{await navigator.clipboard.writeText(summary);toast('Resumo copiado. Pronto para compartilhar.');}catch{$('copyText').value=summary;openDialog('copyDialog');$('copyText').focus();$('copyText').select();}
  });
  if('IntersectionObserver' in window){new IntersectionObserver(entries=>{const visible=entries[0].isIntersecting;$('mobileSummary').classList.toggle('summary-visible',visible);$('mobileSummary').setAttribute('aria-hidden',String(visible));$('mobileSummary').tabIndex=visible?-1:0;},{threshold:.15}).observe(document.querySelector('.price-card'));}
  fieldsFromState();render();
})();
