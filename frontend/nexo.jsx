import { useState, useEffect, useRef, useCallback } from "react";

const FONT_URL = "https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap";
// 👇 Mude para a URL do seu servidor após deploy (ex: "https://api.nexo.seudominio.com")
const API = "https://nexo-backend-tjoj.onrender.com";

const C = {
  bg:"#0d1117",surface:"#161b22",border:"#30363d",borderHover:"#484f58",
  navy:"#0d1117",blue:"#58a6ff",blueLight:"#1c2d45",blueMid:"#1f4068",
  accent:"#79c0ff",green:"#3fb950",greenLight:"#0d2119",yellow:"#d29922",
  yellowLight:"#2d2000",red:"#f85149",redLight:"#2d0f0f",purple:"#bc8cff",
  purpleLight:"#1b1028",text:"#e6edf3",textMid:"#b1bac4",textSub:"#8b949e",
  textLight:"#484f58",sidebar:"#010409",sidebarActive:"#1f6feb",
};

// ─── API CLIENT ──────────────────────────────────────────────────────────────

function getToken() { return localStorage.getItem("nexo_token") || ""; }

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) };
  try {
    const r = await fetch(`${API}${path}`, { ...opts, headers });
    if (r.status === 401) { localStorage.removeItem("nexo_token"); window.location.reload(); return null; }
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || `HTTP ${r.status}`); }
    return r.json();
  } catch(e) {
    if (e.message.includes("fetch") || e.message.includes("Failed") || e.message.includes("NetworkError")) {
      throw new Error(`Não foi possível conectar ao servidor. Verifique se o backend está rodando em ${API}`);
    }
    throw e;
  }
}

// Normalize product from API to match UI field names
function normalizeProduct(p) {
  if (!p) return p;
  const imgs = Array.isArray(p.images) ? p.images.filter(Boolean)
    : (typeof p.images === "string" && p.images.startsWith("[")
        ? (() => { try { return JSON.parse(p.images).filter(Boolean); } catch { return []; } })()
        : []);
  const fallback = "https://images.unsplash.com/photo-1518770660439-4636190af475?w=700";
  const primaryImg = p.image_url || imgs[0] || fallback;
  const allImgs = p.image_url
    ? [p.image_url, ...imgs.filter(i => i !== p.image_url)]
    : (imgs.length > 0 ? imgs : [fallback]);
  return {
    ...p,
    id: p.id,
    name: p.title || p.name || "Produto",
    category: p.category || "Outros",
    img: primaryImg,
    imgs: allImgs,
    video: p.video_url || "",
    score: p.score || 0,
    googleTrend: p.google_trend_score || 0,
    growth: p.growth || "+0%",
    salesGlobal: (p.orders_count || 0).toLocaleString("pt-BR"),
    costUSD: p.price_usd || 0,
    costBRL: p.cost_brl || 0,
    importFee: (p.freight_brl || 0) + (p.tax_brl || 0),
    totalCost: p.total_cost_brl || 0,
    sellPrice: p.suggested_sell_price || 0,
    markup: p.markup ? parseFloat(p.markup.toFixed(2)) : 0,
    brStatus: p.br_status || "Não Vendido",
    competition: p.br_status === "Não Vendido" ? "Baixíssima" : p.br_status === "Pouco Vendido" ? "Baixa" : "Alta",
    saturation: p.saturation_pct || (p.br_status === "Não Vendido" ? 5 : p.br_status === "Pouco Vendido" ? 25 : 70),
    opportunity: p.opportunity || (p.br_status === "Não Vendido" ? 95 : p.br_status === "Pouco Vendido" ? 70 : 30),
    sellers: p.fb_ads_count || 0,
    avgPriceBR: null,
    deliveryDays: p.delivery_days || "14-25",
    tags: Array.isArray(p.tags) ? p.tags : [],
    sources: Array.isArray(p.sources) ? p.sources : [],
    brLinks: Array.isArray(p.br_links) ? p.br_links : [],
    ads: Array.isArray(p.ads) ? p.ads.map(a => ({
      id: a.id, title: a.title || "", views: (a.total_engagement || 0).toLocaleString("pt-BR"),
      eng: a.engagement || "Médio", active: a.is_active !== false, type: a.creative_type || "Imagem",
      days: a.days_active || 0, img: a.image_url || fallback, url: a.fb_library_url || "#"
    })) : [],
    highlight: p.highlight || p.score >= 90,
    isNew: p.is_new || false,
    isViral: p.is_viral || false,
    _ai: p.ai_analysis || null,
    _raw: p,
    // Dados pré-calculados do banco (sem precisar de IA)
    targetingSuggestion: Array.isArray(p.targeting_suggestion)
      ? p.targeting_suggestion
      : (typeof p.targeting_suggestion === "string" && p.targeting_suggestion.startsWith("[")
          ? (() => { try { return JSON.parse(p.targeting_suggestion); } catch { return []; } })()
          : []),
    copySuggestion: p.copy_suggestion || "",
  };
}

const statusColor = { "Não Vendido":"green","Pouco Vendido":"yellow","Já Vendido":"red" };

// ─── SCORE BARS (Ecomhunt style) ─────────────────────────────────────────────

function ScoreBars({ breakdown, compact }) {
  const bars = [
    { label:"Demanda",    val:breakdown?.demand||0,     color:C.blue },
    { label:"Margem",     val:breakdown?.margin||0,     color:C.green },
    { label:"Saturação",  val:breakdown?.saturation||0, color:C.yellow },
    { label:"Tendência",  val:breakdown?.trend||0,      color:C.purple },
  ];
  if (compact) return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 10px"}}>
      {bars.map(b=>(
        <div key={b.label}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
            <span style={{fontSize:9,color:C.textLight}}>{b.label}</span>
            <span style={{fontSize:9,fontWeight:700,color:b.color}}>{b.val}</span>
          </div>
          <div style={{height:3,background:C.border,borderRadius:99}}>
            <div style={{width:`${Math.min(b.val,100)}%`,height:"100%",background:b.color,borderRadius:99}}/>
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {bars.map(b=>(
        <div key={b.label}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontSize:12,color:C.textSub,fontWeight:600}}>{b.label}</span>
            <span style={{fontSize:13,fontWeight:800,color:b.color}}>{b.val}/100</span>
          </div>
          <div style={{height:7,background:C.border,borderRadius:99,overflow:"hidden"}}>
            <div style={{width:`${Math.min(b.val,100)}%`,height:"100%",background:`linear-gradient(90deg,${b.color}88,${b.color})`,borderRadius:99,transition:"width 0.8s ease"}}/>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── PRIMITIVES ──────────────────────────────────────────────────────────────

function Tag({ children, color="blue", sm }) {
  const map = { blue:[C.blueLight,C.blue],green:[C.greenLight,C.green],yellow:[C.yellowLight,C.yellow],red:[C.redLight,C.red],purple:[C.purpleLight,C.purple],gray:["#21262d",C.textSub] };
  const [bg,fg] = map[color]||map.blue;
  return <span style={{background:bg,color:fg,border:`1px solid ${bg}`,borderRadius:6,padding:sm?"2px 7px":"3px 9px",fontSize:sm?10:11,fontWeight:600,letterSpacing:0.2,whiteSpace:"nowrap"}}>{children}</span>;
}

function Ring({ val, size=54, stroke=C.blue, bg=C.blueMid }) {
  const r=(size-9)/2,circ=2*Math.PI*r;
  return (
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={bg} strokeWidth={5}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={stroke} strokeWidth={5} strokeDasharray={circ} strokeDashoffset={circ-(val/100)*circ} strokeLinecap="round" style={{transition:"stroke-dashoffset 1s ease"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:C.text}}>{val}</div>
    </div>
  );
}

function Bar({ val, color=C.blue, h=5 }) {
  return <div style={{height:h,background:C.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${Math.min(val,100)}%`,height:"100%",background:color,borderRadius:99,transition:"width 0.9s ease"}}/></div>;
}

function Spinner({ text="Carregando…" }) {
  return <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:48,gap:14}}><div style={{width:36,height:36,border:`3px solid ${C.blueMid}`,borderTopColor:C.blue,borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/><span style={{fontSize:13,color:C.textSub}}>{text}</span></div>;
}

function ScoreBadge({ val }) {
  const color=val>=90?C.green:val>=75?C.blue:C.yellow;
  return <div style={{background:val>=90?C.greenLight:val>=75?C.blueLight:C.yellowLight,color,fontWeight:900,fontSize:12,borderRadius:8,padding:"3px 9px",border:`1px solid ${color}22`}}>{val}/100</div>;
}

function Btn({ children, variant="primary", onClick, small, href, icon, style:extraStyle, disabled }) {
  const styles={
    primary:{background:`linear-gradient(135deg,${C.navy},${C.blue})`,color:"#fff",border:"none"},
    outline:{background:C.surface,color:C.blue,border:`1.5px solid ${C.blue}`},
    ghost:{background:C.blueLight,color:C.blue,border:"none"},
    fb:{background:"#1877F2",color:"#fff",border:"none"},
    danger:{background:C.redLight,color:C.red,border:"none"},
    green:{background:C.greenLight,color:C.green,border:`1.5px solid ${C.green}`},
  };
  const s={...styles[variant]||styles.primary,borderRadius:10,padding:small?"6px 14px":"9px 20px",fontSize:small?12:13,fontWeight:700,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.5:1,display:"inline-flex",alignItems:"center",gap:6,textDecoration:"none",whiteSpace:"nowrap",transition:"opacity 0.15s",...extraStyle};
  const T=href?"a":"button";
  return <T href={href} target={href?"_blank":undefined} rel={href?"noreferrer":undefined} style={s} onClick={disabled?undefined:onClick} disabled={disabled} onMouseEnter={e=>{if(!disabled)e.currentTarget.style.opacity="0.85";}} onMouseLeave={e=>{e.currentTarget.style.opacity="1";}}>{icon&&<span>{icon}</span>}{children}</T>;
}

function EmptyState({ icon="📭", title="Nenhum resultado", sub="" }) {
  return (
    <div style={{textAlign:"center",padding:"60px 20px"}}>
      <div style={{fontSize:52,marginBottom:14}}>{icon}</div>
      <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:6}}>{title}</div>
      {sub&&<div style={{fontSize:13,color:C.textSub}}>{sub}</div>}
    </div>
  );
}

// ─── AUTH SCREEN ─────────────────────────────────────────────────────────────

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login"); // login | register
  const [form, setForm] = useState({ name:"", email:"", password:"" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    setError(""); setLoading(true);
    try {
      let data;
      if (mode === "login") {
        const body = new URLSearchParams({ username: form.email, password: form.password });
        const r = await fetch(`${API}/api/auth/login`, { method:"POST", body, headers:{"Content-Type":"application/x-www-form-urlencoded"} });
        data = await r.json();
        if (!r.ok) throw new Error(data.detail || "Erro no login");
      } else {
        const r = await fetch(`${API}/api/auth/register`, { method:"POST", body: JSON.stringify({name:form.name,email:form.email,password:form.password}), headers:{"Content-Type":"application/json"} });
        data = await r.json();
        if (!r.ok) throw new Error(data.detail || "Erro no cadastro");
      }
      localStorage.setItem("nexo_token", data.access_token);
      localStorage.setItem("nexo_user", JSON.stringify(data.user));
      onAuth(data.user);
    } catch(e) { setError(e.message); }
    setLoading(false);
  }

  const inp = (placeholder, key, type="text") => (
    <input type={type} placeholder={placeholder} value={form[key]}
      onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}
      onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
      style={{width:"100%",padding:"12px 16px",border:`1.5px solid ${C.border}`,borderRadius:12,fontSize:14,outline:"none",fontFamily:"Sora,sans-serif",color:C.text,background:C.surface,marginBottom:12,boxSizing:"border-box"}}
    />
  );

  return (
    <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${C.navy} 0%,#1A3A7A 50%,#0F2356 100%)`,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{width:"100%",maxWidth:400}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:56,height:56,background:"linear-gradient(135deg,#1A56DB,#38BDF8)",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 12px"}}>⚡</div>
          <div style={{fontSize:30,fontWeight:900,color:"#fff",letterSpacing:-1}}>NEXO</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.45)",marginTop:3,letterSpacing:1}}>PRODUCT INTELLIGENCE</div>
        </div>
        {/* Card */}
        <div style={{background:C.surface,borderRadius:22,padding:"30px 28px",boxShadow:"0 32px 80px rgba(0,0,0,0.5)",border:`1px solid ${C.border}`}}>
          <div style={{display:"flex",gap:4,marginBottom:24,background:C.bg,borderRadius:12,padding:4}}>
            {["login","register"].map(m=>(
              <button key={m} onClick={()=>{setMode(m);setError("");}} style={{flex:1,padding:"8px",borderRadius:9,border:"none",fontSize:13,fontWeight:700,cursor:"pointer",background:mode===m?"#fff":"transparent",color:mode===m?C.navy:C.textSub,boxShadow:mode===m?"0 2px 8px rgba(0,0,0,0.08)":"none",transition:"all 0.15s"}}>
                {m==="login"?"Entrar":"Criar Conta"}
              </button>
            ))}
          </div>
          {mode==="register"&&inp("Seu nome","name")}
          {inp("Email","email","email")}
          {inp("Senha","password","password")}
          {error&&<div style={{background:C.redLight,color:C.red,borderRadius:8,padding:"8px 12px",fontSize:12,marginBottom:12,fontWeight:600}}>{error}</div>}
          <Btn onClick={handleSubmit} disabled={loading} style={{width:"100%",justifyContent:"center"}}>
            {loading?"Aguarde…":mode==="login"?"Entrar":"Criar Conta"}
          </Btn>
          <div style={{textAlign:"center",marginTop:16,fontSize:12,color:C.textLight}}>
            Plataforma privada — apenas uso pessoal
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PRODUCT MODAL ───────────────────────────────────────────────────────────

function ProductModal({ p: rawP, onClose, favorites, onToggleFav }) {
  const p = normalizeProduct(rawP);
  const [tab,setTab] = useState("overview");
  const [imgIdx,setImgIdx] = useState(0);
  const [ai,setAi] = useState(p._ai||null);
  const [aiLoading,setAiLoading] = useState(false);
  const [enrich,setEnrich] = useState(null);
  const [enrichLoading,setEnrichLoading] = useState(false);
  const profitPer100 = (p.sellPrice - p.totalCost) * 100;
  const profitPerUnit = parseFloat((p.sellPrice - p.totalCost).toFixed(2));
  const isFav = favorites?.includes(p.id);

  async function fetchAI() {
    if (ai) return;
    setAiLoading(true);
    try {
      const res = await apiFetch(`/api/ai/analyze/${p.id}`, { method:"POST" });
      setAi(res);
    } catch(e) { setAi({ error: e.message }); }
    setAiLoading(false);
  }

  async function fetchEnrich() {
    if (enrich) return;
    setEnrichLoading(true);
    try {
      const res = await apiFetch(`/api/products/${p.id}/enrich`);
      setEnrich(res);
    } catch(e) { setEnrich({ error: e.message }); }
    setEnrichLoading(false);
  }

  useEffect(() => { if (tab==="ia") fetchAI(); }, [tab]);
  useEffect(() => { if (tab==="mercado"||tab==="targeting"||tab==="ads") fetchEnrich(); }, [tab]);

  // Score breakdown — usa enrich se disponível, fallback ao dado do produto
  const breakdown = enrich?.score_breakdown || p._raw?.score_breakdown || null;
  const market    = enrich?.market || null;
  const targeting = enrich?.targeting || null;
  const fbAds     = enrich?.fb_ads || p.ads || [];

  const TABS = [
    {id:"overview",  label:"📦 Produto"},
    {id:"mercado",   label:"🌍 Mercado"},
    {id:"ads",       label:"📢 Anúncios"},
    {id:"targeting", label:"🎯 Targeting IA"},
    {id:"import",    label:"💰 Precificação"},
    {id:"ia",        label:"🤖 Análise IA"},
  ];
  const fallback = "https://images.unsplash.com/photo-1518770660439-4636190af475?w=700";

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(10,20,50,0.6)",zIndex:1000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"16px 12px",overflowY:"auto",backdropFilter:"blur(6px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.surface,borderRadius:22,width:"100%",maxWidth:920,boxShadow:"0 32px 80px rgba(0,0,0,0.6)",border:`1px solid ${C.border}`,overflow:"hidden",marginTop:8,marginBottom:20}}>
        {/* Header */}
        <div style={{background:`linear-gradient(135deg,${C.navy} 0%,#1A3A7A 100%)`,padding:"20px 28px",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
              <Tag color="blue">{p.category}</Tag>
              {p.isViral&&<Tag color="red">🔥 Viral</Tag>}
              {p.isNew&&<Tag color="green">✨ Novo</Tag>}
            </div>
            <div style={{color:"#fff",fontWeight:800,fontSize:21,letterSpacing:-0.5}}>{p.name}</div>
            <div style={{color:"rgba(255,255,255,0.5)",fontSize:13,marginTop:4}}>Score: {p.score}/100 • {p.growth} em 90 dias • {p.salesGlobal} vendas/mês</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <Ring val={p.score} size={54} stroke="#38BDF8" bg="rgba(255,255,255,0.12)"/>
            <button onClick={()=>onToggleFav(p.id)} style={{background:"rgba(255,255,255,0.1)",border:"none",borderRadius:10,padding:"8px 12px",color:isFav?"#FFD700":"rgba(255,255,255,0.5)",cursor:"pointer",fontSize:20}} title={isFav?"Remover dos favoritos":"Salvar nos favoritos"}>{isFav?"★":"☆"}</button>
            <button onClick={onClose} style={{background:"rgba(255,255,255,0.12)",border:"none",borderRadius:10,padding:"8px 12px",color:"#fff",cursor:"pointer",fontSize:18}}>✕</button>
          </div>
        </div>
        {/* Tabs */}
        <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,padding:"0 28px",background:C.bg,overflowX:"auto"}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"none",border:"none",borderBottom:`2px solid ${tab===t.id?C.blue:"transparent"}`,padding:"13px 16px",fontSize:13,fontWeight:tab===t.id?700:500,color:tab===t.id?C.blue:C.textSub,cursor:"pointer",marginBottom:-1,whiteSpace:"nowrap"}}>{t.label}</button>
          ))}
        </div>
        <div style={{padding:"26px 28px"}}>
          {/* OVERVIEW */}
          {tab==="overview"&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:26}}>
              <div>
                <div style={{borderRadius:14,overflow:"hidden",border:`1px solid ${C.border}`,marginBottom:10}}>
                  <img src={p.imgs[imgIdx]||fallback} alt={p.name} onError={e=>e.target.src=fallback} style={{width:"100%",height:270,objectFit:"cover",display:"block"}}/>
                </div>
                <div style={{display:"flex",gap:8,marginBottom:14}}>
                  {p.imgs.map((im,i)=>(
                    <div key={i} onClick={()=>setImgIdx(i)} style={{flex:1,borderRadius:8,overflow:"hidden",cursor:"pointer",border:`2px solid ${imgIdx===i?C.blue:C.border}`}}>
                      <img src={im||fallback} alt="" onError={e=>e.target.src=fallback} style={{width:"100%",height:54,objectFit:"cover",display:"block"}}/>
                    </div>
                  ))}
                </div>
                {p.video&&(
                  <div style={{background:C.bg,borderRadius:12,padding:14,border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:8}}>📹 Vídeo do Produto</div>
                    <video style={{width:"100%",borderRadius:8,maxHeight:140}} controls><source src={p.video} type="video/mp4"/></video>
                    <div style={{marginTop:10}}><Btn variant="outline" href={p.video} icon="⬇️" small>Baixar Vídeo</Btn></div>
                  </div>
                )}
              </div>
              <div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                  <Tag color={statusColor[p.brStatus]||"gray"}>{p.brStatus} no Brasil</Tag>
                  <Tag color="blue">Concorrência {p.competition}</Tag>
                  {p.tags.map(t=><Tag key={t} color="gray" sm>{t}</Tag>)}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
                  {[{l:"Vendas Globais/mês",v:p.salesGlobal,icon:"📦",c:C.navy},{l:"Crescimento 90d",v:p.growth,icon:"📈",c:C.green},{l:"Ads Ativos",v:p.ads.length,icon:"📢",c:C.textMid},{l:"Entrega",v:`${p.deliveryDays} dias`,icon:"✈️",c:C.textMid}].map(s=>(
                    <div key={s.l} style={{background:C.bg,borderRadius:12,padding:"12px 14px",border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:18}}>{s.icon}</div>
                      <div style={{fontSize:17,fontWeight:800,color:s.c,marginTop:4}}>{s.v}</div>
                      <div style={{fontSize:11,color:C.textLight,marginTop:1}}>{s.l}</div>
                    </div>
                  ))}
                </div>
                <div style={{background:`linear-gradient(135deg,${C.blueLight},#0d1f3c)`,borderRadius:14,padding:18,border:`1px solid ${C.blueMid}`,marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:800,color:C.blue,marginBottom:12,letterSpacing:0.5}}>💰 PRECIFICAÇÃO</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
                    {[{l:"Custo ($)",v:`$${p.costUSD}`,c:C.textSub},{l:"Custo (R$)",v:`R$${p.totalCost}`,c:C.text},{l:"Venda",v:`R$${p.sellPrice}`,c:C.green},{l:"Lucro/un.",v:`R$${profitPerUnit}`,c:C.yellow}].map((x,i)=>(
                      <div key={x.l} style={{textAlign:"center",padding:"8px 4px",borderRight:i<3?`1px solid ${C.blueMid}`:"none"}}>
                        <div style={{fontSize:10,color:C.textSub,marginBottom:3}}>{x.l}</div>
                        <div style={{fontSize:14,fontWeight:800,color:x.c}}>{x.v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <div style={{flex:1,background:C.bg,borderRadius:8,padding:"7px 10px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:C.textSub}}>Markup</div>
                      <div style={{fontSize:22,fontWeight:900,color:C.blue}}>×{p.markup}</div>
                    </div>
                    <div style={{flex:1,background:C.bg,borderRadius:8,padding:"7px 10px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:C.textSub}}>Margem</div>
                      <div style={{fontSize:22,fontWeight:900,color:C.green}}>{(p._raw?.margin_pct||0).toFixed(0)}%</div>
                    </div>
                    <div style={{flex:1,background:C.bg,borderRadius:8,padding:"7px 10px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:C.textSub}}>Lucro/100un.</div>
                      <div style={{fontSize:16,fontWeight:900,color:C.yellow}}>R${profitPer100.toLocaleString("pt-BR")}</div>
                    </div>
                  </div>
                </div>
                {/* Score visual */}
                <div style={{background:C.bg,borderRadius:14,padding:"16px 18px",border:`1px solid ${C.border}`,marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div style={{fontSize:12,fontWeight:800,color:C.text}}>📊 Score por Dimensão</div>
                    <div style={{background:p.score>=90?C.greenLight:p.score>=75?C.blueLight:C.yellowLight,color:p.score>=90?C.green:p.score>=75?C.blue:C.yellow,fontWeight:900,fontSize:14,borderRadius:8,padding:"3px 10px",border:`1px solid ${p.score>=90?C.green:p.score>=75?C.blue:C.yellow}22`}}>{p.score}/100</div>
                  </div>
                  {breakdown ? <ScoreBars breakdown={breakdown}/> : (
                    <div style={{display:"flex",justifyContent:"center",padding:"10px 0"}}>
                      <Btn variant="ghost" onClick={fetchEnrich} small icon="📊" disabled={enrichLoading}>{enrichLoading?"Calculando…":"Calcular Scores"}</Btn>
                    </div>
                  )}
                </div>
                {/* Quick action buttons */}
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
                  {(p._raw?.product_detail_url||p._raw?.product_url) && (
                    <Btn variant="outline" href={p._raw?.product_detail_url||p._raw?.product_url} icon="🛒" small>Ver no AliExpress</Btn>
                  )}
                  <Btn variant="fb" href={fbAdsUrl(p.name)} small icon="🔍">Spy Ads Facebook</Btn>
                  {p.img && <Btn variant="ghost" href={`${API}/api/download/media?url=${encodeURIComponent(p.img)}&filename=${encodeURIComponent((p.name||"produto").slice(0,30))}.jpg`} small icon="⬇️">Baixar Foto</Btn>}
                </div>
                {p.sources.length>0&&(
                  <>
                    <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:10}}>🛒 Comprar na Origem</div>
                    {p.sources.map(s=>(
                      <a key={s.name||s.url} href={s.url} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",marginBottom:8,textDecoration:"none",transition:"background 0.15s"}} onMouseEnter={e=>e.currentTarget.style.background=C.blueLight} onMouseLeave={e=>e.currentTarget.style.background=C.bg}>
                        <span style={{fontSize:13,fontWeight:600,color:C.text}}>{s.icon||"🛒"} {s.name}</span>
                        <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:13,fontWeight:700,color:C.blue}}>{s.price}</span><span style={{fontSize:11,color:C.textLight}}>↗</span></div>
                      </a>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
          {/* MERCADO */}
          {tab==="mercado"&&(
            <div>
              {enrichLoading&&<Spinner text="Carregando dados de mercado…"/>}
              {!enrichLoading&&enrich?.error&&<div style={{background:C.redLight,color:C.red,borderRadius:10,padding:"12px 16px",fontSize:13,marginBottom:16}}>{enrich.error}</div>}
              {!enrichLoading&&market&&(
                <div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14,marginBottom:20}}>
                    <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:11,color:C.textSub,fontWeight:700,marginBottom:6}}>🏪 VENDEDORES NO ML</div>
                      <div style={{fontSize:26,fontWeight:900,color:C.blue,marginBottom:2}}>{market.ml_seller_label}</div>
                      <div style={{fontSize:12,color:C.textSub}}>atualmente anunciando</div>
                    </div>
                    <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:11,color:C.textSub,fontWeight:700,marginBottom:6}}>📊 SATURAÇÃO BR</div>
                      <div style={{fontSize:26,fontWeight:900,color:market.saturation_pct<30?C.green:market.saturation_pct<60?C.yellow:C.red,marginBottom:6}}>{market.saturation_label}</div>
                      <div style={{height:6,background:C.border,borderRadius:99}}><div style={{width:`${market.saturation_pct}%`,height:"100%",background:market.saturation_pct<30?C.green:market.saturation_pct<60?C.yellow:C.red,borderRadius:99}}/></div>
                    </div>
                    <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:11,color:C.textSub,fontWeight:700,marginBottom:6}}>⏳ TEMPO NO MERCADO</div>
                      <div style={{fontSize:26,fontWeight:900,color:C.purple,marginBottom:2}}>{market.time_in_market}</div>
                      <div style={{fontSize:12,color:C.textSub}}>no mercado global</div>
                    </div>
                    <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:11,color:C.textSub,fontWeight:700,marginBottom:6}}>📈 TENDÊNCIA DE DEMANDA</div>
                      <div style={{fontSize:22,fontWeight:900,color:market.demand_trend==="Alta"?C.green:market.demand_trend==="Crescente"?C.blue:C.textMid,marginBottom:2}}>{market.demand_trend}</div>
                      <div style={{fontSize:12,color:C.textSub}}>baseado em comissões globais</div>
                    </div>
                  </div>
                  <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:13,fontWeight:800,color:C.text,marginBottom:14}}>🌍 Países Comprando Ativamente</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {market.countries_selling.map(c=>(
                        <span key={c} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"5px 12px",fontSize:12,fontWeight:600,color:C.text}}>{c}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {!enrichLoading&&!market&&!enrich?.error&&(
                <div style={{display:"flex",justifyContent:"center",padding:"30px 0"}}>
                  <Btn variant="ghost" onClick={fetchEnrich} icon="🌍">Carregar dados de mercado</Btn>
                </div>
              )}
            </div>
          )}
          {/* ADS */}
          {tab==="ads"&&(
            <div>
              <div style={{marginBottom:20}}>
                <div style={{fontSize:16,fontWeight:800,color:C.text,marginBottom:4}}>📢 Spy de Anúncios</div>
                <div style={{fontSize:13,color:C.textSub}}>Anúncios ativos — clique para abrir na Biblioteca do Facebook</div>
              </div>
              {enrichLoading&&<Spinner text="Buscando anúncios…"/>}
              {!enrichLoading&&fbAds.length===0&&<EmptyState icon="📢" title="Sem anúncios detectados" sub="Nenhum anúncio encontrado para este produto."/>}
              {!enrichLoading&&fbAds.map(ad=>(
                <div key={ad.id||ad.fb_library_url} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden",display:"flex",marginBottom:14,flexWrap:"wrap"}}>
                  <div style={{position:"relative",width:140,flexShrink:0,minHeight:100}}>
                    <img src={ad.thumbnail||ad.img||fallback} alt="ad" onError={e=>e.target.src=fallback} style={{width:"100%",height:"100%",minHeight:100,objectFit:"cover",display:"block"}}/>
                    {ad.type==="Vídeo"&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:32,height:32,background:"rgba(255,255,255,0.9)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>▶</div></div>}
                  </div>
                  <div style={{padding:"16px 18px",flex:1,minWidth:200}}>
                    <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:10}}>
                      <Tag color="green">● Ativo</Tag>
                      <Tag color="blue">{ad.type||"Imagem"}</Tag>
                      <Tag color={ad.engagement==="Explosivo"?"red":ad.engagement==="Muito Alto"?"purple":"blue"}>{ad.engagement||"Alto"}</Tag>
                      <Tag color="gray" sm>⏱ {ad.days_running||ad.days||0} dias</Tag>
                    </div>
                    <div style={{display:"flex",gap:16,marginBottom:14,flexWrap:"wrap"}}>
                      <div style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:800,color:C.blue}}>{(ad.likes||0).toLocaleString("pt-BR")}</div><div style={{fontSize:10,color:C.textSub}}>👍 Curtidas</div></div>
                      <div style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:800,color:C.green}}>{(ad.comments||0).toLocaleString("pt-BR")}</div><div style={{fontSize:10,color:C.textSub}}>💬 Comentários</div></div>
                      <div style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:800,color:C.purple}}>{(ad.shares||0).toLocaleString("pt-BR")}</div><div style={{fontSize:10,color:C.textSub}}>🔁 Shares</div></div>
                    </div>
                    <Btn variant="fb" href={ad.fb_library_url||ad.url||"#"} icon="📢" small>Ver na Biblioteca do Facebook ↗</Btn>
                  </div>
                </div>
              ))}
              {p.brLinks.length===0&&(
                <div style={{marginTop:16,background:C.greenLight,border:"1px solid #BBF7D0",borderRadius:14,padding:"16px 20px",display:"flex",alignItems:"center",gap:12}}>
                  <div style={{fontSize:28}}>🎯</div>
                  <div><div style={{fontSize:14,fontWeight:700,color:C.green}}>Nicho Livre no Brasil!</div><div style={{fontSize:13,color:C.textSub,marginTop:2}}>Nenhum concorrente encontrado nos marketplaces monitorados.</div></div>
                </div>
              )}
            </div>
          )}
          {/* TARGETING IA */}
          {tab==="targeting"&&(
            <div>
              {enrichLoading&&<Spinner text="Gerando targeting com IA…"/>}
              {!enrichLoading&&enrich?.error&&<div style={{background:C.redLight,color:C.red,borderRadius:10,padding:"12px 16px",fontSize:13,marginBottom:16}}>{enrich.error}</div>}
              {!enrichLoading&&targeting&&(
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:16}}>
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:12,fontWeight:800,color:C.text,marginBottom:12}}>🎯 Interesses Sugeridos (Facebook)</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {(targeting.interests||[]).map(i=>(
                          <span key={i} style={{background:C.blueLight,color:C.blue,border:`1px solid ${C.blueMid}`,borderRadius:8,padding:"5px 12px",fontSize:12,fontWeight:600}}>{i}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:12,fontWeight:800,color:C.text,marginBottom:12}}>👥 Público-alvo</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        <div><div style={{fontSize:10,color:C.textSub,marginBottom:3}}>FAIXA ETÁRIA</div><div style={{fontSize:15,fontWeight:800,color:C.text}}>{targeting.age_range}</div></div>
                        <div><div style={{fontSize:10,color:C.textSub,marginBottom:3}}>GÊNERO</div><div style={{fontSize:13,fontWeight:700,color:C.text}}>{targeting.gender}</div></div>
                        <div style={{gridColumn:"1/-1"}}><div style={{fontSize:10,color:C.textSub,marginBottom:3}}>CPM ESTIMADO</div><div style={{fontSize:15,fontWeight:800,color:C.yellow}}>{targeting.cpm_estimate}</div></div>
                      </div>
                    </div>
                    <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:12,fontWeight:800,color:C.text,marginBottom:12}}>🌍 Países para Testar</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {(targeting.countries_to_test||[]).map(c=>(
                          <span key={c} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:600,color:C.textMid}}>{c}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <div style={{background:`linear-gradient(135deg,${C.blueLight},#0d1f3c)`,borderRadius:14,padding:18,border:`1px solid ${C.blueMid}`}}>
                      <div style={{fontSize:12,fontWeight:800,color:C.blue,marginBottom:8}}>📣 Headline Sugerida</div>
                      <div style={{fontSize:15,fontWeight:700,color:C.text,lineHeight:1.5}}>{targeting.headline}</div>
                    </div>
                    <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`,flex:1}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                        <div style={{fontSize:12,fontWeight:800,color:C.text}}>✍️ Copy Completa</div>
                        <button onClick={()=>{navigator.clipboard?.writeText(targeting.full_ad_copy||targeting.copy||"");}} style={{background:C.surface,color:C.blue,border:`1px solid ${C.blue}`,borderRadius:8,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>📋 Copiar</button>
                      </div>
                      <div style={{fontSize:12,color:C.textSub,lineHeight:1.7,whiteSpace:"pre-line",background:C.surface,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.border}`}}>{targeting.full_ad_copy||targeting.copy}</div>
                    </div>
                  </div>
                </div>
              )}
              {!enrichLoading&&!targeting&&!enrich?.error&&p.targetingSuggestion?.length>0&&(
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:16}}>
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:12,fontWeight:800,color:C.text,marginBottom:12}}>🎯 Interesses Sugeridos (Facebook)</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {p.targetingSuggestion.map(i=>(
                          <span key={i} style={{background:C.blueLight,color:C.blue,border:`1px solid ${C.blueMid}`,borderRadius:8,padding:"5px 12px",fontSize:12,fontWeight:600}}>{i}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  {p.copySuggestion&&(
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>
                      <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`,flex:1}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                          <div style={{fontSize:12,fontWeight:800,color:C.text}}>✍️ Copy Sugerida</div>
                          <button onClick={()=>{navigator.clipboard?.writeText(p.copySuggestion);}} style={{background:C.surface,color:C.blue,border:`1px solid ${C.blue}`,borderRadius:8,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>📋 Copiar</button>
                        </div>
                        <div style={{fontSize:12,color:C.textSub,lineHeight:1.7,whiteSpace:"pre-line",background:C.surface,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.border}`}}>{p.copySuggestion}</div>
                      </div>
                    </div>
                  )}
                  <div style={{gridColumn:"1/-1",display:"flex",justifyContent:"center",paddingTop:8}}>
                    <Btn variant="ghost" onClick={fetchEnrich} icon="🤖" small>Gerar análise completa com IA</Btn>
                  </div>
                </div>
              )}
              {!enrichLoading&&!targeting&&!enrich?.error&&(!p.targetingSuggestion||p.targetingSuggestion.length===0)&&(
                <div style={{display:"flex",justifyContent:"center",padding:"30px 0"}}>
                  <Btn variant="ghost" onClick={fetchEnrich} icon="🎯">Gerar Targeting com IA</Btn>
                </div>
              )}
            </div>
          )}
          {/* IMPORT */}
          {tab==="import"&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:20}}>
              <div>
                <div style={{background:C.bg,borderRadius:14,padding:20,border:`1px solid ${C.border}`,marginBottom:14}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:14}}>📊 Breakdown de Custos</div>
                  {[{l:"Preço de origem",v:`$${p.costUSD} USD`,sub:`≈ R$${p.costBRL.toFixed(0)}`},{l:"Frete internacional",v:`R$${((p.importFee||0)*0.4).toFixed(0)}`},{l:"Impostos + Taxas",v:`R$${((p.importFee||0)*0.6).toFixed(0)}`},{l:"Total landed cost",v:`R$${p.totalCost}`,bold:true},{l:"Preço sugerido de venda",v:`R$${p.sellPrice}`,bold:true,blue:true}].map(x=>(
                    <div key={x.l} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                      <span style={{fontSize:13,color:C.textSub}}>{x.l}</span>
                      <div style={{textAlign:"right"}}><div style={{fontSize:13,fontWeight:x.bold?800:600,color:x.blue?C.blue:C.text}}>{x.v}</div>{x.sub&&<div style={{fontSize:10,color:C.textLight}}>{x.sub}</div>}</div>
                    </div>
                  ))}
                  <div style={{marginTop:14,background:C.blueLight,borderRadius:10,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:12,fontWeight:600,color:C.blue}}>MARKUP FINAL</span>
                    <span style={{fontSize:28,fontWeight:900,color:C.navy}}>×{p.markup}</span>
                  </div>
                </div>
              </div>
              <div>
                <div style={{background:C.bg,borderRadius:14,padding:20,border:`1px solid ${C.border}`,marginBottom:14}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:14}}>📈 Saturação e Oportunidade</div>
                  <div style={{marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:12,color:C.textSub}}>Saturação no Brasil</span><span style={{fontSize:12,fontWeight:700,color:p.saturation<20?C.green:C.yellow}}>{p.saturation}%</span></div>
                    <Bar val={p.saturation} color={p.saturation<20?C.green:C.yellow}/>
                  </div>
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:12,color:C.textSub}}>Score de Oportunidade</span><span style={{fontSize:12,fontWeight:700,color:C.green}}>{p.opportunity}%</span></div>
                    <Bar val={p.opportunity} color={C.green}/>
                  </div>
                </div>
                <div style={{background:C.greenLight,borderRadius:14,padding:20,border:"1px solid #BBF7D0"}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.green,marginBottom:12}}>✅ Simulação: 100 unidades</div>
                  {[["Investimento",`R$${(p.totalCost*100).toLocaleString("pt-BR")}`],["Receita estimada",`R$${(p.sellPrice*100).toLocaleString("pt-BR")}`],["Lucro bruto",`R$${profitPer100.toLocaleString("pt-BR")}`,true]].map(([l,v,bold])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #D1FAE5"}}>
                      <span style={{fontSize:12,color:C.textSub}}>{l}</span>
                      <span style={{fontSize:13,fontWeight:bold?900:700,color:bold?C.green:C.text}}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* IA */}
          {tab==="ia"&&(
            <div>
              {aiLoading?<Spinner text="IA processando…"/>:ai&&!ai.error?(
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
                  <div style={{background:`linear-gradient(135deg,${C.navy},${C.blue})`,borderRadius:16,padding:22,color:"#fff",gridColumn:"1/-1"}}>
                    <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.5)",letterSpacing:1,marginBottom:8}}>🎯 ANÁLISE DE OPORTUNIDADE</div>
                    <div style={{fontSize:18,fontWeight:800,lineHeight:1.45,marginBottom:10}}>{ai.headline}</div>
                    <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontSize:12,color:"rgba(255,255,255,0.55)"}}>Nota da IA:</span>
                      <span style={{fontSize:22,fontWeight:900,color:"#38BDF8"}}>{ai.nota}/10</span>
                      {ai.melhorCanal&&<span style={{marginLeft:"auto"}}><Tag color="blue">📡 {ai.melhorCanal}</Tag></span>}
                    </div>
                  </div>
                  <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:10}}>👥 Público-Alvo</div>
                    <div style={{fontSize:13,color:C.textMid,lineHeight:1.65}}>{ai.publico}</div>
                  </div>
                  <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:10}}>🏷️ Palavras-chave</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>{ai.palavrasChave?.map(k=><Tag key={k} color="blue">{k}</Tag>)}</div>
                    <div style={{fontSize:12,fontWeight:700,color:C.red,marginBottom:6}}>⚠️ Risco</div>
                    <div style={{fontSize:13,color:C.textMid,lineHeight:1.6}}>{ai.risco}</div>
                  </div>
                  <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:10}}>📣 Ângulos de Copy</div>
                    {ai.copys?.map((c,i)=>(
                      <div key={i} style={{display:"flex",gap:10,marginBottom:10}}>
                        <span style={{background:C.blueLight,color:C.blue,borderRadius:"50%",minWidth:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800}}>{i+1}</span>
                        <span style={{fontSize:12,color:C.textMid,lineHeight:1.55}}>{c}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{background:C.bg,borderRadius:14,padding:18,border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:10}}>🚧 Objeções e Respostas</div>
                    {ai.objecoes?.map((o,i)=>(
                      <div key={i} style={{fontSize:12,color:C.textMid,lineHeight:1.55,marginBottom:10,paddingLeft:12,borderLeft:`3px solid ${C.blueMid}`}}>{o}</div>
                    ))}
                  </div>
                  {ai.melhorEpoca&&<div style={{background:C.yellowLight,borderRadius:14,padding:18,border:"1px solid #FDE68A"}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.yellow,marginBottom:6}}>🗓️ Melhor Época para Vender</div>
                    <div style={{fontSize:13,color:C.textMid,lineHeight:1.6}}>{ai.melhorEpoca}</div>
                  </div>}
                  <div style={{background:C.greenLight,borderRadius:14,padding:18,border:"1px solid #BBF7D0",gridColumn:"1/-1"}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.green,marginBottom:8}}>🚀 ESTRATÉGIA DE LANÇAMENTO</div>
                    <div style={{fontSize:14,color:C.text,lineHeight:1.75,whiteSpace:"pre-line"}}>{ai.estrategia}</div>
                  </div>
                </div>
              ):(
                <div style={{textAlign:"center",padding:"48px 20px"}}>
                  {ai?.error&&<div style={{background:C.redLight,color:C.red,borderRadius:8,padding:"8px 12px",marginBottom:16,fontSize:12}}>{ai.error}</div>}
                  <div style={{fontSize:52,marginBottom:16}}>🤖</div>
                  <div style={{fontSize:17,fontWeight:700,color:C.text,marginBottom:8}}>Análise Estratégica por IA</div>
                  <div style={{fontSize:13,color:C.textSub,marginBottom:24}}>A IA vai analisar o produto e gerar estratégia personalizada para o mercado brasileiro</div>
                  <Btn onClick={fetchAI} icon="🤖">Gerar Análise</Btn>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PRODUCT CARD ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  const pulse = {animation:"pulse 1.5s ease-in-out infinite"};
  return (
    <div style={{background:C.surface,borderRadius:18,border:`1px solid ${C.border}`,overflow:"hidden"}}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
      <div style={{height:192,background:C.border,...pulse}}/>
      <div style={{padding:"13px 15px"}}>
        <div style={{height:10,background:C.border,borderRadius:6,marginBottom:8,width:"40%",...pulse}}/>
        <div style={{height:14,background:C.border,borderRadius:6,marginBottom:6,...pulse}}/>
        <div style={{height:12,background:C.border,borderRadius:6,marginBottom:12,width:"70%",...pulse}}/>
        <div style={{height:48,background:C.border,borderRadius:10,marginBottom:8,...pulse}}/>
        <div style={{height:10,background:C.border,borderRadius:6,width:"60%",...pulse}}/>
      </div>
    </div>
  );
}

function ProductCard({ p: rawP, onClick, favorites, onToggleFav }) {
  const p = normalizeProduct(rawP);
  const isFav = favorites?.includes(p.id);
  return (
    <div onClick={()=>onClick(rawP)} style={{background:C.surface,borderRadius:18,border:p.highlight?`2px solid ${C.blue}`:`1px solid ${C.border}`,overflow:"hidden",cursor:"pointer",transition:"all 0.2s ease",boxShadow:p.highlight?`0 4px 20px ${C.blue}22`:"0 1px 6px rgba(0,0,0,0.04)",position:"relative"}} onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-4px)";e.currentTarget.style.boxShadow=`0 14px 40px ${C.blue}18`;}} onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow=p.highlight?`0 4px 20px ${C.blue}22`:"0 1px 6px rgba(0,0,0,0.04)";}}>
      <div style={{position:"relative",height:192,overflow:"hidden"}}>
        <img src={p.img} alt={p.name} onError={e=>e.target.src="https://images.unsplash.com/photo-1518770660439-4636190af475?w=700"} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
        <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,0.5) 0%,transparent 55%)"}}/>
        {p.highlight&&<div style={{position:"absolute",top:10,left:10,background:`linear-gradient(135deg,${C.navy},${C.blue})`,color:"#fff",fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:20}}>⭐ TOP PICK</div>}
        {p.isNew&&<div style={{position:"absolute",top:10,right:36,background:C.green,color:"#fff",fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:20}}>✨ NOVO</div>}
        <button onClick={e=>{e.stopPropagation();onToggleFav(p.id);}} style={{position:"absolute",top:8,right:8,background:"rgba(0,0,0,0.35)",border:"none",borderRadius:8,width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:15,color:isFav?"#FFD700":"rgba(255,255,255,0.7)"}}>{isFav?"★":"☆"}</button>
        <div style={{position:"absolute",bottom:10,left:12}}><span style={{background:"rgba(255,255,255,0.92)",color:C.green,fontSize:11,fontWeight:800,padding:"3px 9px",borderRadius:20}}>{p.growth}</span></div>
        <div style={{position:"absolute",bottom:10,right:12}}><Ring val={p.score} size={42} stroke={p.score>=90?"#22C55E":C.blue} bg="rgba(255,255,255,0.18)"/></div>
      </div>
      <div style={{padding:"13px 15px"}}>
        <div style={{fontSize:10,color:C.textLight,marginBottom:3,fontWeight:500,textTransform:"uppercase",letterSpacing:0.5}}>{p.category}</div>
        <div style={{fontSize:13,fontWeight:700,color:C.text,lineHeight:1.35,marginBottom:9}}>{p.name}</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:11}}>
          <Tag color={statusColor[p.brStatus]||"gray"} sm>{p.brStatus}</Tag>
          <Tag color="blue" sm>{p.competition}</Tag>
          {p.isViral&&<Tag color="red" sm>🔥 Viral</Tag>}
        </div>
        <div style={{background:C.bg,borderRadius:10,padding:"9px 11px",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}>
          <div><div style={{fontSize:9,color:C.textLight}}>Custo</div><div style={{fontSize:12,fontWeight:700,color:C.text}}>R${p.totalCost}</div></div>
          <div style={{color:C.border,fontSize:14}}>›</div>
          <div><div style={{fontSize:9,color:C.textLight}}>Vender</div><div style={{fontSize:13,fontWeight:800,color:C.green}}>R${p.sellPrice}</div></div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:9,color:C.textLight}}>Lucro/un.</div>
            <div style={{fontSize:13,fontWeight:800,color:C.yellow}}>R${(p.sellPrice-p.totalCost).toFixed(0)}</div>
          </div>
          <div style={{background:C.blueLight,borderRadius:7,padding:"3px 8px",textAlign:"center"}}><div style={{fontSize:8,color:C.blue,fontWeight:600}}>MARKUP</div><div style={{fontSize:14,fontWeight:900,color:C.navy}}>×{p.markup}</div></div>
        </div>
        <div style={{marginBottom:8}}>
          <ScoreBars breakdown={p._raw?.score_breakdown} compact/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between"}}>
          <span style={{fontSize:10,color:C.textSub}}>📦 {p.salesGlobal}/mês</span>
          <span style={{fontSize:10,color:p._raw?.margin_pct>=50?C.green:C.yellow,fontWeight:700}}>💰 {(p._raw?.margin_pct||0).toFixed(0)}% margem</span>
        </div>
      </div>
    </div>
  );
}

// ─── MODULES ─────────────────────────────────────────────────────────────────

function imgProxy(url) {
  if (!url) return "https://images.unsplash.com/photo-1518770660439-4636190af475?w=400&h=400&fit=crop";
  if (url.includes("alicdn.com") || url.includes("aliexpress") || url.includes("aliexpress-media.com") || url.includes("ae-pic-a1"))
    return `${API}/api/download/image?url=${encodeURIComponent(url)}`;
  return url;
}

function fbAdsUrl(title) {
  const kws = (title || "").split(" ").slice(0,5).join(" ");
  return `https://www.facebook.com/ads/library/?q=${encodeURIComponent(kws)}&search_type=keyword_unordered&media_type=all&active_status=all&countries[0]=BR`;
}

function WinningProducts({ onSelect, favorites, onToggleFav }) {
  const [products, setProducts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [mining, setMining]       = useState(false);
  const [mineMsg, setMineMsg]     = useState("");
  const [view, setView]           = useState("table"); // table | cards
  const [cat, setCat]             = useState("Todos");
  const [sort, setSort]           = useState("score");
  const [drawer, setDrawer]       = useState(null); // product for AI drawer
  const cats = ["Todos","Saúde e Beleza","Casa Inteligente","Pet","Fitness em Casa","Bebês e Crianças","Eletrônicos","Cozinha"];

  function load() {
    setLoading(true);
    const params = new URLSearchParams({ sort_by: sort, limit: 50 });
    if (cat !== "Todos") params.set("category", cat);
    apiFetch(`/api/products?${params}`)
      .then(d => { setProducts(d?.products || []); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(load, [cat, sort]);

  async function triggerHotSync() {
    setMining(true); setMineMsg("🔥 Sincronizando produtos HOT da AliExpress True API…");
    try {
      const res = await apiFetch("/api/mining/hot-sync", { method: "POST" });
      setMineMsg(`✅ Sync iniciado (ID: ${res.scan_id?.slice(0,8)}…). Aguarde ~30s e recarregue.`);
      setTimeout(() => { load(); setMineMsg(""); }, 35000);
    } catch(e) { setMineMsg(`Erro: ${e.message}`); }
    setMining(false);
  }

  async function triggerMining() {
    setMining(true); setMineMsg("Conectando ao AliExpress DS Center…");
    try {
      const res = await apiFetch("/api/mining/scan", { method: "POST" });
      setMineMsg(`Mineração iniciada (ID: ${res.scan_id?.slice(0,8)}…). Aguarde ~60s e recarregue.`);
      setTimeout(() => { load(); setMineMsg(""); }, 65000);
    } catch(e) { setMineMsg(`Erro: ${e.message}`); }
    setMining(false);
  }

  const marginPct = (p) => {
    const total = p.total_cost_brl || 0;
    const sell  = p.suggested_sell_price || 0;
    if (!total || !sell) return 0;
    return Math.round(((sell - total) / sell) * 100);
  };

  const hotColor  = "#FF4444";
  const TH = ({children, w}) => (
    <th style={{padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:700,color:C.textSub,letterSpacing:0.5,textTransform:"uppercase",borderBottom:`2px solid ${C.border}`,whiteSpace:"nowrap",width:w||"auto",background:C.bg}}>
      {children}
    </th>
  );

  return (
    <div>
      {/* ── Toolbar ── */}
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:18,alignItems:"center"}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",flex:1,minWidth:0}}>
          {cats.map(c=>(
            <button key={c} onClick={()=>setCat(c)} style={{padding:"6px 13px",borderRadius:9,border:`1.5px solid ${cat===c?C.blue:C.border}`,background:cat===c?C.blueLight:C.surface,color:cat===c?C.blue:C.textSub,fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
              {c}
            </button>
          ))}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
          <select value={sort} onChange={e=>setSort(e.target.value)} style={{padding:"8px 12px",borderRadius:9,border:`1.5px solid ${C.border}`,fontSize:12,fontWeight:600,color:C.text,background:C.surface,cursor:"pointer",outline:"none"}}>
            <option value="score">Score</option>
            <option value="markup">Markup</option>
            <option value="opportunity">Oportunidade</option>
            <option value="newest">Mais Novo</option>
          </select>
          <div style={{display:"flex",border:`1.5px solid ${C.border}`,borderRadius:9,overflow:"hidden"}}>
            {[["table","☰"],["cards","⊞"]].map(([v,icon])=>(
              <button key={v} onClick={()=>setView(v)} style={{padding:"7px 12px",border:"none",background:view===v?C.blueLight:C.surface,color:view===v?C.blue:C.textSub,cursor:"pointer",fontSize:14,fontWeight:700}}>{icon}</button>
            ))}
          </div>
          <Btn onClick={triggerHotSync} disabled={mining} variant="green" icon="🔥" small>
            {mining ? "Sincronizando…" : "Sync HOT API"}
          </Btn>
          <Btn onClick={triggerMining} disabled={mining} variant="primary" icon="⛏️" small>
            {mining ? "Minerando…" : "Minerar DS Center"}
          </Btn>
        </div>
      </div>

      {/* ── Mining feedback ── */}
      {mineMsg && (
        <div style={{background:C.blueLight,border:`1px solid ${C.blue}22`,borderRadius:10,padding:"10px 16px",marginBottom:14,fontSize:12,color:C.blue,fontWeight:600}}>
          ⛏️ {mineMsg}
        </div>
      )}

      {/* ── Content ── */}
      {loading && view === "cards" ? (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:18}}>
          {Array.from({length:8}).map((_,i)=><SkeletonCard key={i}/>)}
        </div>
      ) : loading ? <Spinner text="Carregando produtos…"/> : products.length === 0 ? (
        <div style={{textAlign:"center",padding:"60px 20px"}}>
          <div style={{fontSize:48,marginBottom:14}}>⛏️</div>
          <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:8}}>Banco vazio — clique em "Minerar AliExpress"</div>
          <div style={{fontSize:13,color:C.textSub,marginBottom:20}}>O robô vai buscar os bestsellers do DS Center em tempo real.</div>
          <Btn onClick={triggerMining} disabled={mining} icon="⛏️">
            {mining ? "Minerando…" : "Iniciar Mineração Agora"}
          </Btn>
        </div>
      ) : view === "table" ? (

        /* ── TABELA PROFISSIONAL ── */
        <div style={{background:C.surface,borderRadius:16,border:`1px solid ${C.border}`,overflow:"hidden"}}>
          <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:C.bg}}>
            <span style={{fontSize:13,fontWeight:700,color:C.text}}>
              {products.length} produtos encontrados
            </span>
            <span style={{fontSize:11,color:C.textSub}}>Atualizado a cada 12h · Clique na linha para análise completa</span>
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead>
                <tr>
                  <TH w="60px">Preview</TH>
                  <TH>Produto</TH>
                  <TH w="100px">Vendas/mês</TH>
                  <TH w="90px">Preço Ali</TH>
                  <TH w="90px">Vender por</TH>
                  <TH w="80px">Margem</TH>
                  <TH w="80px">Score</TH>
                  <TH w="130px">Ações</TH>
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => {
                  const norm     = normalizeProduct(p);
                  const margin   = marginPct(p);
                  const isHot    = p.is_viral || p.orders_count >= 200000;
                  const imgSrc   = imgProxy(norm.img);
                  const fallback = "https://images.unsplash.com/photo-1518770660439-4636190af475?w=80&h=80&fit=crop";
                  return (
                    <tr key={p.id} onClick={()=>setDrawer(p)}
                      style={{borderBottom:`1px solid ${C.border}`,cursor:"pointer",transition:"background 0.12s"}}
                      onMouseEnter={e=>e.currentTarget.style.background=C.blueLight}
                      onMouseLeave={e=>e.currentTarget.style.background=C.bg}
                    >
                      {/* Preview */}
                      <td style={{padding:"8px 10px"}}>
                        <div style={{position:"relative",width:50,height:50,borderRadius:10,overflow:"hidden",border:`1px solid ${C.border}`,flexShrink:0}}>
                          <img src={imgSrc} alt="" onError={e=>{e.target.src=fallback;}} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                          {isHot && <div style={{position:"absolute",top:2,left:2,background:hotColor,borderRadius:4,padding:"1px 4px",fontSize:8,fontWeight:900,color:"#fff",letterSpacing:0.3}}>HOT</div>}
                        </div>
                      </td>
                      {/* Produto */}
                      <td style={{padding:"8px 14px",maxWidth:320}}>
                        <div style={{fontWeight:700,color:C.text,fontSize:13,marginBottom:3,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{p.title}</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          <span style={{fontSize:10,background:C.blueLight,color:C.blue,borderRadius:5,padding:"1px 6px",fontWeight:600}}>{p.category}</span>
                          <span style={{fontSize:10,background:p.br_status==="Não Vendido"?C.greenLight:C.yellowLight,color:p.br_status==="Não Vendido"?C.green:C.yellow,borderRadius:5,padding:"1px 6px",fontWeight:600}}>{p.br_status}</span>
                          {p.growth && <span style={{fontSize:10,color:C.green,fontWeight:700}}>{p.growth}</span>}
                        </div>
                      </td>
                      {/* Vendas */}
                      <td style={{padding:"8px 14px",textAlign:"right",whiteSpace:"nowrap"}}>
                        <div style={{fontWeight:800,color:C.text,fontSize:14}}>{(p.orders_count||0).toLocaleString("pt-BR")}</div>
                        <div style={{fontSize:10,color:C.textLight}}>{p.platform}</div>
                      </td>
                      {/* Preço Ali */}
                      <td style={{padding:"8px 14px",textAlign:"right",whiteSpace:"nowrap"}}>
                        <div style={{fontWeight:700,color:C.text}}>$ {(p.price_usd||0).toFixed(2)}</div>
                        <div style={{fontSize:10,color:C.textSub}}>R$ {(p.cost_brl||0).toFixed(0)}</div>
                      </td>
                      {/* Vender por */}
                      <td style={{padding:"8px 14px",textAlign:"right",whiteSpace:"nowrap"}}>
                        <div style={{fontWeight:800,color:C.green,fontSize:14}}>R$ {(p.suggested_sell_price||0).toFixed(0)}</div>
                        <div style={{fontSize:10,color:C.textSub}}>×{(p.markup||0).toFixed(1)} markup</div>
                      </td>
                      {/* Margem */}
                      <td style={{padding:"8px 14px",textAlign:"center"}}>
                        <div style={{background:margin>=40?C.greenLight:margin>=25?C.yellowLight:C.redLight,color:margin>=40?C.green:margin>=25?C.yellow:C.red,borderRadius:8,padding:"4px 8px",fontWeight:800,fontSize:13,display:"inline-block",minWidth:48,textAlign:"center"}}>
                          {margin}%
                        </div>
                      </td>
                      {/* Score */}
                      <td style={{padding:"8px 14px",textAlign:"center"}}>
                        <ScoreBadge val={p.score||0}/>
                      </td>
                      {/* Ações */}
                      <td style={{padding:"8px 10px"}} onClick={e=>e.stopPropagation()}>
                        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                          <button onClick={e=>{e.stopPropagation();setDrawer(p);}} title="Análise IA" style={{padding:"5px 9px",borderRadius:7,border:`1px solid ${C.blue}`,background:C.blueLight,color:C.blue,fontSize:11,fontWeight:700,cursor:"pointer"}}>
                            🤖 IA
                          </button>
                          {(p.product_detail_url||p.product_url) && (
                            <a href={p.product_detail_url||p.product_url} target="_blank" rel="noreferrer"
                               title="Ver no AliExpress" style={{padding:"5px 9px",borderRadius:7,border:`1px solid ${C.border}`,background:C.surface,color:"#ff6600",fontSize:11,fontWeight:700,textDecoration:"none",display:"inline-flex",alignItems:"center"}}>
                              Ali
                            </a>
                          )}
                          <a href={fbAdsUrl(p.title)} target="_blank" rel="noreferrer"
                             title="Spy no Facebook Ads Library" style={{padding:"5px 9px",borderRadius:7,border:"1px solid #1877F2",background:"#1877F211",color:"#1877F2",fontSize:11,fontWeight:700,textDecoration:"none",display:"inline-flex",alignItems:"center"}}>
                            Ads
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      ) : (
        /* ── CARDS (modo alternativo) ── */
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:18}}>
          {products.map(p=><ProductCard key={p.id} p={p} onClick={p=>setDrawer(p)} favorites={favorites} onToggleFav={onToggleFav}/>)}
        </div>
      )}
      {/* AI Drawer */}
      {drawer && (
        <AIDrawer
          product={drawer}
          onClose={()=>setDrawer(null)}
          onOpenFull={()=>{ onSelect(drawer); setDrawer(null); }}
        />
      )}
    </div>
  );
}

function TrendRadar() {
  const [trends, setTrends] = useState([]);
  const [rising, setRising] = useState([]);
  const [ai, setAi] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch("/api/trends").catch(()=>({trends:[]})),
      apiFetch("/api/trends/rising").catch(()=>({rising:[]})),
    ]).then(([t,r])=>{ setTrends(t?.trends||[]); setRising(r?.rising||[]); setLoading(false); });
  }, []);

  async function getInsights() {
    setAiLoading(true);
    const res = await apiFetch("/api/ai/insights", { method:"POST" }).catch(e=>({ error:e.message }));
    setAi(res); setAiLoading(false);
  }

  if (loading) return <Spinner/>;

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22,flexWrap:"wrap",gap:10}}>
        <div><div style={{fontSize:16,fontWeight:800,color:C.text}}>📡 Tendências no Brasil (Google Trends)</div><div style={{fontSize:13,color:C.textSub,marginTop:3}}>Dados em tempo real via SerpAPI</div></div>
        <Btn onClick={getInsights} disabled={aiLoading} icon="🤖">{aiLoading?"Analisando…":"Analisar com IA"}</Btn>
      </div>
      {ai&&!ai.error&&(
        <div style={{background:`linear-gradient(135deg,${C.navy},${C.blue})`,borderRadius:18,padding:24,color:"#fff",marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.5)",letterSpacing:1,marginBottom:8}}>🤖 ANÁLISE DE TENDÊNCIAS</div>
          <div style={{fontSize:16,fontWeight:800,marginBottom:8}}>{ai.semana}</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>{ai.alertas?.map((a,i)=><span key={i} style={{background:"rgba(255,255,255,0.12)",borderRadius:8,padding:"4px 10px",fontSize:12}}>{a}</span>)}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12,marginTop:12}}>
            {ai.tendencias?.map((t,i)=>(
              <div key={i} style={{background:"rgba(255,255,255,0.1)",borderRadius:12,padding:"12px 14px"}}>
                <div style={{fontSize:20,marginBottom:6}}>{t.emoji}</div>
                <div style={{fontWeight:700,fontSize:13,marginBottom:2}}>{t.nome}</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",marginBottom:6}}>{t.descricao}</div>
                <div style={{display:"flex",gap:8}}><span style={{fontSize:11,background:"rgba(255,255,255,0.15)",borderRadius:6,padding:"2px 8px"}}>Score {t.score}</span><span style={{fontSize:11,color:"#86EFAC"}}>{t.crescimento}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}
      {trends.length===0?<EmptyState icon="📡" title="Sem dados de trends" sub="Configure SERPAPI_KEY no backend para ver tendências em tempo real."/>:(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:16,marginBottom:24}}>
          {trends.sort((a,b)=>b.trend_score-a.trend_score).slice(0,6).map(t=>(
            <div key={t.keyword} style={{background:C.surface,borderRadius:16,padding:18,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:8}}>{t.keyword}</div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:12,color:C.textSub}}>Interesse</span><span style={{fontSize:12,fontWeight:800,color:C.blue}}>{t.trend_score}/100</span></div>
              <Bar val={t.trend_score} color={C.blue}/>
            </div>
          ))}
        </div>
      )}
      {rising.length>0&&(
        <>
          <div style={{fontSize:14,fontWeight:800,color:C.text,marginBottom:14}}>🚀 Em Alta Agora</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {rising.slice(0,12).map((r,i)=>(
              <div key={i} style={{background:r.is_breakout?C.greenLight:C.blueLight,border:`1px solid ${r.is_breakout?"#BBF7D0":C.blueMid}`,borderRadius:10,padding:"8px 14px"}}>
                <div style={{fontSize:13,fontWeight:700,color:r.is_breakout?C.green:C.blue}}>{r.query}</div>
                <div style={{fontSize:11,color:C.textSub}}>{r.is_breakout?"🔥 Breakout":r.growth}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AdsSpy() {
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("Todos");
  const [keyword, setKeyword] = useState("");
  const types = ["Todos","Vídeo","Imagem","Carrossel","Reels"];

  useEffect(() => {
    const params = new URLSearchParams({ limit: 50 });
    if (keyword) params.set("keyword", keyword);
    apiFetch(`/api/ads?${params}`).then(d=>{ setAds(d?.ads||[]); setLoading(false); }).catch(()=>setLoading(false));
  }, [keyword]);

  const filtered = filter==="Todos" ? ads : ads.filter(a=>a.creative_type===filter);
  const fallback = "https://images.unsplash.com/photo-1518770660439-4636190af475?w=400";

  return (
    <div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:22,alignItems:"center"}}>
        <div style={{display:"flex",gap:6,flex:1,flexWrap:"wrap"}}>
          {types.map(t=>(
            <button key={t} onClick={()=>setFilter(t)} style={{padding:"7px 14px",borderRadius:10,border:`1.5px solid ${filter===t?C.blue:C.border}`,background:filter===t?C.blueLight:C.surface,color:filter===t?C.blue:C.textSub,fontSize:12,fontWeight:700,cursor:"pointer"}}>{t}</button>
          ))}
        </div>
        <input placeholder="Buscar por keyword…" value={keyword} onChange={e=>setKeyword(e.target.value)} style={{padding:"8px 14px",border:`1.5px solid ${C.border}`,borderRadius:10,fontSize:13,outline:"none",fontFamily:"Sora,sans-serif",width:200,background:C.surface,color:C.text}}/>
      </div>
      {loading?<Spinner text="Carregando anúncios…"/>:filtered.length===0?<EmptyState icon="📢" title="Sem anúncios" sub="Configure APIFY_TOKEN para espionar anúncios em tempo real."/>:(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:16}}>
          {filtered.map(ad=>(
            <div key={ad.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden"}}>
              <div style={{position:"relative",height:160}}>
                <img src={ad.image_url||fallback} alt="" onError={e=>e.target.src=fallback} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                {ad.creative_type==="Vídeo"&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:44,height:44,background:"rgba(255,255,255,0.9)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>▶</div></div>}
                <div style={{position:"absolute",top:8,left:8}}><Tag color={ad.is_active?"green":"gray"}>{ad.is_active?"● Ativo":"○ Pausado"}</Tag></div>
              </div>
              <div style={{padding:"14px 16px"}}>
                <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                  <Tag color="blue">{ad.creative_type||"Imagem"}</Tag>
                  <Tag color="purple">{ad.engagement||"Médio"}</Tag>
                  <Tag color="gray" sm>⏱ {ad.days_active||0} dias</Tag>
                </div>
                <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:4,lineHeight:1.4}}>{ad.title||"Anúncio"}</div>
                <div style={{fontSize:12,color:C.textSub,marginBottom:12}}>{ad.advertiser||"Anunciante"}</div>
                <div style={{display:"flex",gap:8}}>
                  <Btn variant="fb" href={ad.fb_library_url||"#"} icon="📢" small>Ver no Facebook</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketGap({ onSelect, favorites, onToggleFav }) {
  const [gaps, setGaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ai, setAi] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    apiFetch("/api/gaps?min_opportunity=70").then(d=>{ setGaps(d?.gaps||[]); setLoading(false); }).catch(()=>setLoading(false));
  }, []);

  async function analyzeGaps() {
    setAiLoading(true);
    const res = await apiFetch("/api/ai/gap-analysis", { method:"POST" }).catch(e=>({error:e.message}));
    setAi(res); setAiLoading(false);
  }

  if (loading) return <Spinner/>;

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:16,fontWeight:800,color:C.text}}>🎯 Nichos Livres no Brasil</div>
          <div style={{fontSize:13,color:C.textSub,marginTop:3}}>Produtos trending globalmente sem concorrência no BR</div>
        </div>
        <Btn onClick={analyzeGaps} disabled={aiLoading} icon="🤖">{aiLoading?"Analisando…":"Analisar Gaps com IA"}</Btn>
      </div>
      {ai&&!ai.error&&(
        <div style={{background:`linear-gradient(135deg,${C.green},#059669)`,borderRadius:18,padding:24,color:"#fff",marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.6)",letterSpacing:1,marginBottom:8}}>🎯 ANÁLISE DE LACUNAS DE MERCADO</div>
          <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>Melhor oportunidade: {ai.melhorOportunidade}</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.8)",marginBottom:12,lineHeight:1.6}}>{ai.motivo}</div>
          <div style={{background:"rgba(255,255,255,0.15)",borderRadius:10,padding:"10px 14px"}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>⏰ Janela de oportunidade: {ai.janela}</div>
            <div style={{fontSize:13,lineHeight:1.6}}>{ai.estrategia}</div>
          </div>
        </div>
      )}
      {gaps.length===0?<EmptyState icon="🎯" title="Nenhum gap detectado" sub="Rode um scan para encontrar nichos livres no Brasil."/>:(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:18}}>
          {gaps.map(p=>(
            <div key={p.id} style={{position:"relative"}}>
              <div style={{position:"absolute",top:-8,left:12,zIndex:1,background:`linear-gradient(135deg,${C.green},#059669)`,color:"#fff",fontSize:10,fontWeight:800,padding:"3px 10px",borderRadius:20,letterSpacing:0.5}}>🎯 NICHO LIVRE</div>
              <ProductCard p={p} onClick={onSelect} favorites={favorites} onToggleFav={onToggleFav}/>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfitCalculator() {
  const [form, setForm] = useState({ costUSD:20, usdBrl:0, freight:25, tax:15, markup:3, qty:100, marketplace:"shopee" });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [ai, setAi] = useState(null);
  const update = (k,v) => setForm(f=>({...f,[k]:parseFloat(v)||0}));

  async function calculate() {
    setLoading(true);
    const params = new URLSearchParams({ cost_usd:form.costUSD, usd_brl:form.usdBrl||0, freight:form.freight/6, tax:form.tax, markup:form.markup, qty:form.qty, marketplace:form.marketplace });
    const res = await apiFetch(`/api/calculator?${params}`).catch(e=>null);
    setResult(res); setLoading(false);
  }

  async function aiAnalyze() {
    if (!result) return;
    setAiLoading(true);
    // Build a synthetic product for AI analysis
    const synth = { title:"Produto Analisado", price_usd:form.costUSD, total_cost_brl:result.total_cost_brl, suggested_sell_price:result.suggested_sell_price, markup:result.markup, orders_count:0, br_status:"Não Vendido", score:0 };
    try {
      const r = await fetch(`${API}/api/ai/analyze/calc`, { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${getToken()}` }, body:JSON.stringify(synth) });
      const d = await r.json();
      setAi(d);
    } catch(e) { setAi({error:e.message}); }
    setAiLoading(false);
  }

  const INP = (label, key, min=0, step=0.1) => (
    <div style={{marginBottom:14}}>
      <label style={{fontSize:12,fontWeight:600,color:C.textSub,display:"block",marginBottom:5}}>{label}</label>
      <input type="number" value={form[key]} min={min} step={step} onChange={e=>update(key,e.target.value)} style={{width:"100%",padding:"10px 14px",border:`1.5px solid ${C.border}`,borderRadius:10,fontSize:14,fontFamily:"Sora,sans-serif",outline:"none",color:C.text,background:C.surface,boxSizing:"border-box"}}/>
    </div>
  );

  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:22}}>
      <div style={{background:C.surface,borderRadius:18,padding:24,border:`1px solid ${C.border}`}}>
        <div style={{fontSize:15,fontWeight:800,color:C.text,marginBottom:20}}>💰 Parâmetros de Importação</div>
        {INP("Custo na origem (USD)","costUSD",0,0.5)}
        {INP("Cotação USD/BRL (0 = automático)","usdBrl",0,0.01)}
        {INP("Frete (BRL)","freight",0,5)}
        {INP("Impostos (BRL)","tax",0,5)}
        {INP("Markup desejado","markup",1,0.1)}
        {INP("Quantidade para simular","qty",1,10)}
        <div style={{marginBottom:20}}>
          <label style={{fontSize:12,fontWeight:600,color:C.textSub,display:"block",marginBottom:5}}>Marketplace</label>
          <select value={form.marketplace} onChange={e=>setForm(f=>({...f,marketplace:e.target.value}))} style={{width:"100%",padding:"10px 14px",border:`1.5px solid ${C.border}`,borderRadius:10,fontSize:14,fontFamily:"Sora,sans-serif",outline:"none",color:C.text,background:C.surface}}>
            {[["shopee","Shopee (14%)"],["mercadolivre_classico","Mercado Livre Clássico (13%)"],["mercadolivre_premium","Mercado Livre Premium (18%)"],["amazon","Amazon BR (15%)"],["proprio","Loja Própria (0%)"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <Btn onClick={calculate} disabled={loading} style={{width:"100%",justifyContent:"center"}} icon="🧮">{loading?"Calculando…":"Calcular"}</Btn>
      </div>
      <div>
        {result&&(
          <>
            <div style={{background:result.viable?C.greenLight:C.yellowLight,border:`1px solid ${result.viable?"#BBF7D0":"#FDE68A"}`,borderRadius:18,padding:24,marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <div style={{fontSize:15,fontWeight:800,color:C.text}}>📊 Resultado</div>
                <div style={{background:result.viable?C.green:C.yellow,color:"#fff",borderRadius:8,padding:"4px 12px",fontSize:12,fontWeight:800}}>{result.rating}</div>
              </div>
              {[["Custo BRL",`R$${result.cost_brl?.toFixed(2)}`],["Frete BRL",`R$${result.freight_brl?.toFixed(2)}`],[`Impostos (${result.tax_rate_pct}%)`,`R$${result.tax_brl?.toFixed(2)}`],["Custo Total",`R$${result.total_cost_brl?.toFixed(2)}`,true],["Preço de Venda",`R$${result.suggested_sell_price?.toFixed(2)}`,false,true],["Markup",`×${result.markup}`,true],["Margem",`${result.margin_pct}%`],["Taxa USD/BRL",result.usd_brl_rate?.toFixed(4)]].map(([l,v,bold,blue])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${result.viable?"#D1FAE5":"#FDE68A"}`}}>
                  <span style={{fontSize:13,color:C.textSub}}>{l}</span>
                  <span style={{fontSize:13,fontWeight:bold||blue?800:600,color:blue?C.green:C.text}}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{background:C.blueLight,borderRadius:16,padding:20,border:`1px solid ${C.blueMid}`,marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:800,color:C.navy,marginBottom:14}}>📦 Simulação: {result.simulation?.qty} unidades</div>
              {[["Investimento total",`R$${result.simulation?.total_investment?.toLocaleString("pt-BR")}`],["Receita total",`R$${result.simulation?.total_revenue?.toLocaleString("pt-BR")}`],["Lucro bruto",`R$${result.simulation?.gross_profit?.toLocaleString("pt-BR")}`,true],["ROI",`${result.simulation?.roi_pct}%`,false,true],["Break-even",`${result.simulation?.break_even_units} unidades`]].map(([l,v,bold,green])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.blueMid}`}}>
                  <span style={{fontSize:12,color:C.textSub}}>{l}</span>
                  <span style={{fontSize:13,fontWeight:bold||green?800:600,color:green?C.green:C.text}}>{v}</span>
                </div>
              ))}
            </div>
            <Btn onClick={aiAnalyze} disabled={aiLoading} style={{width:"100%",justifyContent:"center"}} icon="🤖">{aiLoading?"Analisando…":"Análise da IA"}</Btn>
            {ai&&!ai.error&&(
              <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:20,marginTop:16}}>
                <div style={{fontSize:12,fontWeight:800,color:C.navy,marginBottom:8}}>🤖 {ai.headline}</div>
                <div style={{fontSize:13,color:C.textMid,lineHeight:1.6}}>{ai.estrategia}</div>
              </div>
            )}
          </>
        )}
        {!result&&<EmptyState icon="🧮" title="Configure e calcule" sub="Preencha os parâmetros e clique em Calcular"/>}
      </div>
    </div>
  );
}

function CreativeDownloader() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("Todos");

  useEffect(() => {
    apiFetch("/api/products?limit=30").then(d=>{setProducts(d?.products||[]);setLoading(false);}).catch(()=>setLoading(false));
  }, []);

  const creatives = products.flatMap(p => {
    const np = normalizeProduct(p);
    return [...np.imgs.map((img,i)=>({id:`${p.id}-img-${i}`,type:"Imagem",name:`${np.name} — Foto ${i+1}`,url:img,product:np})),
      ...(np.video?[{id:`${p.id}-vid`,type:"Vídeo",name:`${np.name} — Vídeo`,url:np.video,product:np}]:[]),
      ...np.ads.filter(a=>a.img).map(a=>({id:`ad-${a.id}`,type:a.type||"Imagem",name:`Ad: ${a.title.slice(0,30)}`,url:a.img,product:np}))];
  });
  const filtered = filter==="Todos"?creatives:creatives.filter(c=>c.type===filter);
  const fallback = "https://images.unsplash.com/photo-1518770660439-4636190af475?w=400";

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:22,flexWrap:"wrap"}}>
        {["Todos","Imagem","Vídeo"].map(t=>(
          <button key={t} onClick={()=>setFilter(t)} style={{padding:"7px 14px",borderRadius:10,border:`1.5px solid ${filter===t?C.blue:C.border}`,background:filter===t?C.blueLight:C.surface,color:filter===t?C.blue:C.textSub,fontSize:12,fontWeight:700,cursor:"pointer"}}>{t}</button>
        ))}
        <span style={{marginLeft:"auto",fontSize:13,color:C.textSub,alignSelf:"center"}}>{filtered.length} criativos</span>
      </div>
      {loading?<Spinner/>:filtered.length===0?<EmptyState icon="🖼️" title="Sem criativos" sub="Os criativos aparecem conforme os produtos são carregados."/>:(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:14}}>
          {filtered.map(c=>(
            <div key={c.id} style={{background:C.surface,borderRadius:14,border:`1px solid ${C.border}`,overflow:"hidden"}}>
              <div style={{position:"relative",height:150}}>
                {c.type==="Vídeo"?(
                  <video style={{width:"100%",height:"100%",objectFit:"cover"}}><source src={c.url} type="video/mp4"/></video>
                ):(
                  <img src={c.url||fallback} alt="" onError={e=>e.target.src=fallback} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                )}
                <div style={{position:"absolute",top:6,left:6}}><Tag color={c.type==="Vídeo"?"purple":"blue"} sm>{c.type}</Tag></div>
              </div>
              <div style={{padding:"10px 12px"}}>
                <div style={{fontSize:11,color:C.textSub,marginBottom:8,lineHeight:1.4}}>{c.name}</div>
                <Btn variant="ghost" href={c.url} icon="⬇️" small style={{width:"100%",justifyContent:"center"}}>Baixar</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Favorites({ onSelect, favorites, onToggleFav }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/products/favorites").then(d=>{ setProducts(d?.favorites||[]); setLoading(false); }).catch(()=>setLoading(false));
  }, []);

  if (loading) return <Spinner/>;
  return (
    <div>
      <div style={{marginBottom:22}}>
        <div style={{fontSize:16,fontWeight:800,color:C.text}}>★ Produtos Salvos</div>
        <div style={{fontSize:13,color:C.textSub,marginTop:3}}>Seus produtos favoritos para acompanhar</div>
      </div>
      {products.length===0?<EmptyState icon="★" title="Nenhum produto salvo" sub="Clique no ★ em qualquer produto para salvar aqui."/>:(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:18}}>
          {products.map(p=><ProductCard key={p.id} p={p} onClick={onSelect} favorites={favorites} onToggleFav={onToggleFav}/>)}
        </div>
      )}
    </div>
  );
}

function Settings({ user }) {
  const [settings, setSettings] = useState({ email_enabled:true, telegram_enabled:false, telegram_chat_id:"", min_score_alert:85, daily_digest:true });
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    apiFetch("/api/notifications/settings").then(d=>{ if(d&&Object.keys(d).length>0) setSettings(d); }).catch(()=>{});
  }, []);

  async function save() {
    setLoading(true);
    await apiFetch("/api/notifications/settings", { method:"PUT", body:JSON.stringify(settings) }).catch(()=>{});
    setLoading(false); setSaved(true); setTimeout(()=>setSaved(false),2000);
  }

  async function testNotif() {
    setTested(true);
    await apiFetch("/api/notifications/test", { method:"POST" }).catch(()=>{});
    setTimeout(()=>setTested(false),3000);
  }

  const Toggle = ({label,desc,k}) => (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 0",borderBottom:`1px solid ${C.border}`}}>
      <div><div style={{fontSize:14,fontWeight:600,color:C.text}}>{label}</div>{desc&&<div style={{fontSize:12,color:C.textSub,marginTop:2}}>{desc}</div>}</div>
      <button onClick={()=>setSettings(s=>({...s,[k]:!s[k]}))} style={{width:44,height:24,borderRadius:12,border:"none",background:settings[k]?C.blue:C.border,cursor:"pointer",position:"relative",transition:"background 0.2s"}}>
        <div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:settings[k]?22:3,transition:"left 0.2s"}}/>
      </button>
    </div>
  );

  return (
    <div style={{maxWidth:600}}>
      <div style={{fontSize:16,fontWeight:800,color:C.text,marginBottom:22}}>⚙️ Configurações</div>
      <div style={{background:C.surface,borderRadius:18,padding:24,border:`1px solid ${C.border}`,marginBottom:20}}>
        <div style={{fontSize:14,fontWeight:800,color:C.text,marginBottom:16}}>👤 Sua Conta</div>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <div style={{width:44,height:44,borderRadius:12,background:`linear-gradient(135deg,${C.navy},${C.blue})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:18,fontWeight:700}}>
            {user?.name?.[0]?.toUpperCase()||"U"}
          </div>
          <div><div style={{fontSize:15,fontWeight:700,color:C.text}}>{user?.name||"Usuário"}</div><div style={{fontSize:13,color:C.textSub}}>{user?.email||""}</div></div>
        </div>
      </div>
      <div style={{background:C.surface,borderRadius:18,padding:24,border:`1px solid ${C.border}`,marginBottom:20}}>
        <div style={{fontSize:14,fontWeight:800,color:C.text,marginBottom:4}}>🔔 Notificações</div>
        <Toggle label="Email" desc="Receber alertas no email cadastrado" k="email_enabled"/>
        <Toggle label="Telegram" desc="Receber alertas no Telegram" k="telegram_enabled"/>
        {settings.telegram_enabled&&(
          <div style={{padding:"12px 0",borderBottom:`1px solid ${C.border}`}}>
            <label style={{fontSize:12,fontWeight:600,color:C.textSub,display:"block",marginBottom:5}}>Chat ID do Telegram</label>
            <input value={settings.telegram_chat_id||""} onChange={e=>setSettings(s=>({...s,telegram_chat_id:e.target.value}))} placeholder="Ex: 123456789" style={{width:"100%",padding:"10px 14px",border:`1.5px solid ${C.border}`,borderRadius:10,fontSize:14,fontFamily:"Sora,sans-serif",outline:"none",background:C.surface,color:C.text,boxSizing:"border-box"}}/>
            <div style={{fontSize:11,color:C.textSub,marginTop:4}}>Envie /start para @NexoAlertBot e cole aqui o ID recebido</div>
          </div>
        )}
        <Toggle label="Resumo diário" desc="Email com top 3 produtos às 8h todo dia" k="daily_digest"/>
        <div style={{padding:"14px 0"}}>
          <label style={{fontSize:12,fontWeight:600,color:C.textSub,display:"block",marginBottom:8}}>Score mínimo para alerta: <strong style={{color:C.text}}>{settings.min_score_alert}</strong></label>
          <input type="range" min={50} max={99} value={settings.min_score_alert} onChange={e=>setSettings(s=>({...s,min_score_alert:parseInt(e.target.value)}))} style={{width:"100%",accentColor:C.blue}}/>
        </div>
      </div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <Btn onClick={save} disabled={loading} icon={saved?"✅":"💾"}>{saved?"Salvo!":loading?"Salvando…":"Salvar Configurações"}</Btn>
        <Btn variant="outline" onClick={testNotif} disabled={tested} icon="🧪">{tested?"Enviado!":"Testar Notificação"}</Btn>
      </div>
    </div>
  );
}

function Dashboard({ onNav }) {
  const [stats, setStats] = useState({ total:0, markup3x:0, nichos:0, ads:0 });
  const [trending, setTrending] = useState([]);
  const [best, setBest] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/products?sort_by=score&limit=20").then(d=>{
      const products = d?.products || [];
      setTrending(products.slice(0,4));
      setBest(products[0]||null);
      setStats({
        total: products.length,
        markup3x: products.filter(p=>p.markup>=3).length,
        nichos: products.filter(p=>p.br_status==="Não Vendido").length,
        ads: products.reduce((s,p)=>s+(p.fb_ads_count||0),0),
      });
      setLoading(false);
    }).catch(()=>setLoading(false));
  }, []);

  if (loading) return <Spinner/>;

  const bestP = best ? normalizeProduct(best) : null;
  const statCards = [
    {icon:"📊",l:"Produtos Monitorados",v:stats.total||"0",sub:"escaneados agora",c:C.blue},
    {icon:"🔥",l:"Markup ≥ 3×",v:stats.markup3x||"0",sub:"oportunidades",c:C.green},
    {icon:"🎯",l:"Nichos Livres BR",v:stats.nichos||"0",sub:"sem concorrência",c:C.yellow},
    {icon:"📢",l:"Ads Detectados",v:stats.ads||"0",sub:"FB + Instagram",c:C.purple},
  ];

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:16,marginBottom:28}}>
        {statCards.map(s=>(
          <div key={s.l} style={{background:C.surface,borderRadius:18,padding:"20px 22px",border:`1px solid ${C.border}`,boxShadow:"0 1px 6px rgba(0,0,0,0.03)"}}>
            <div style={{fontSize:22,marginBottom:8}}>{s.icon}</div>
            <div style={{fontSize:26,fontWeight:900,color:C.text,letterSpacing:-1}}>{s.v}</div>
            <div style={{fontSize:13,fontWeight:700,color:s.c,marginTop:2}}>{s.l}</div>
            <div style={{fontSize:11,color:C.textLight,marginTop:2}}>{s.sub}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:22}}>
        <div style={{background:C.surface,borderRadius:18,padding:22,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:14,fontWeight:800,color:C.text,marginBottom:16}}>🔥 Em Tendência Agora</div>
          {trending.length===0?<EmptyState icon="🔍" title="Sem dados" sub="Rode um scan para ver produtos"/>:trending.map((raw,i)=>{
            const p = normalizeProduct(raw);
            return (
              <div key={p.id} style={{display:"flex",gap:12,alignItems:"center",padding:"10px 0",borderBottom:i<trending.length-1?`1px solid ${C.border}`:"none"}}>
                <div style={{fontSize:18,fontWeight:900,color:C.textLight,minWidth:24,textAlign:"center"}}>{i+1}</div>
                <img src={p.img} alt="" onError={e=>e.target.src="https://images.unsplash.com/photo-1518770660439-4636190af475?w=200"} style={{width:44,height:44,borderRadius:10,objectFit:"cover"}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.text,lineHeight:1.3,marginBottom:2}}>{p.name}</div>
                  <div style={{display:"flex",gap:6}}><Tag sm color={statusColor[p.brStatus]||"gray"}>{p.brStatus}</Tag><Tag sm color="blue">×{p.markup}</Tag></div>
                </div>
                <ScoreBadge val={p.score}/>
              </div>
            );
          })}
        </div>
        {bestP&&(
          <div style={{background:`linear-gradient(135deg,${C.navy} 0%,#1E3A8A 100%)`,borderRadius:18,padding:22,color:"#fff"}}>
            <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",letterSpacing:1,marginBottom:12}}>⚡ MELHOR PRODUTO AGORA</div>
            <img src={bestP.img} alt="" onError={e=>e.target.src="https://images.unsplash.com/photo-1518770660439-4636190af475?w=400"} style={{width:"100%",height:140,objectFit:"cover",borderRadius:12,marginBottom:12}}/>
            <div style={{fontWeight:800,fontSize:16,marginBottom:6}}>{bestP.name}</div>
            <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
              <span style={{fontSize:13,color:"rgba(255,255,255,0.7)"}}>Score: <strong style={{color:"#38BDF8"}}>{bestP.score}</strong></span>
              <span style={{fontSize:13,color:"rgba(255,255,255,0.7)"}}>Markup: <strong style={{color:"#4ADE80"}}>×{bestP.markup}</strong></span>
              <span style={{fontSize:13,color:"rgba(255,255,255,0.7)"}}>{bestP.growth}</span>
            </div>
            <Btn onClick={()=>onNav("produtos")} variant="outline" style={{borderColor:"rgba(255,255,255,0.3)",color:"#fff",background:"rgba(255,255,255,0.1)"}}>Ver todos →</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NOTIFICATIONS PANEL ─────────────────────────────────────────────────────

function NotificationsPanel({ onClose }) {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/notifications?limit=20").then(d=>{ setNotifs(d?.notifications||[]); setLoading(false); }).catch(()=>setLoading(false));
  }, []);

  async function markRead(id) {
    await apiFetch(`/api/notifications/${id}/read`, { method:"POST" }).catch(()=>{});
    setNotifs(n=>n.map(x=>x.id===id?{...x,is_read:true}:x));
  }

  const unread = notifs.filter(n=>!n.is_read).length;

  return (
    <div style={{position:"fixed",top:60,right:16,width:340,background:C.surface,borderRadius:18,boxShadow:"0 12px 48px rgba(0,0,0,0.5)",border:`1px solid ${C.border}`,zIndex:200,overflow:"hidden"}}>
      <div style={{padding:"16px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:14,fontWeight:800,color:C.text}}>🔔 Notificações {unread>0&&<span style={{background:C.blue,color:"#fff",borderRadius:12,padding:"1px 7px",fontSize:11,marginLeft:6}}>{unread}</span>}</div>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:C.textSub,fontSize:18}}>✕</button>
      </div>
      <div style={{maxHeight:380,overflowY:"auto"}}>
        {loading?<Spinner/>:notifs.length===0?<EmptyState icon="🔔" title="Sem notificações" sub="Os alertas de novos produtos aparecerão aqui."/>:notifs.map(n=>(
          <div key={n.id} onClick={()=>markRead(n.id)} style={{padding:"14px 20px",borderBottom:`1px solid ${C.border}`,background:n.is_read?C.surface:C.blueLight,cursor:"pointer"}}>
            <div style={{fontSize:13,fontWeight:n.is_read?600:800,color:C.text,marginBottom:3}}>{n.title}</div>
            <div style={{fontSize:12,color:C.textSub,lineHeight:1.5}}>{n.body}</div>
            <div style={{fontSize:11,color:C.textLight,marginTop:4}}>{new Date(n.created_at).toLocaleString("pt-BR")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── EXPORT BUTTON ────────────────────────────────────────────────────────────

function ExportBtn() {
  const [open, setOpen] = useState(false);

  function download(fmt) {
    const url = `${API}/api/export/${fmt}`;
    const a = document.createElement("a");
    a.href = url;
    a.headers = { Authorization: `Bearer ${getToken()}` };
    // For auth, fetch and create blob
    fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r=>r.blob())
      .then(blob=>{
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `nexo_produtos.${fmt}`;
        link.click();
      });
    setOpen(false);
  }

  return (
    <div style={{position:"relative"}}>
      <Btn onClick={()=>setOpen(o=>!o)} variant="outline" small icon="⬇️">Exportar</Btn>
      {open&&(
        <div style={{position:"absolute",top:"100%",right:0,marginTop:4,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,boxShadow:"0 8px 24px rgba(0,0,0,0.4)",zIndex:100,minWidth:140,overflow:"hidden"}}>
          <button onClick={()=>download("csv")} style={{display:"block",width:"100%",padding:"10px 16px",border:"none",background:C.surface,textAlign:"left",fontSize:13,fontWeight:600,color:C.text,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background=C.blueLight} onMouseLeave={e=>e.currentTarget.style.background=C.surface}>📊 CSV (Excel)</button>
          <button onClick={()=>download("json")} style={{display:"block",width:"100%",padding:"10px 16px",border:"none",background:C.surface,textAlign:"left",fontSize:13,fontWeight:600,color:C.text,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background=C.blueLight} onMouseLeave={e=>e.currentTarget.style.background=C.surface}>📄 JSON</button>
        </div>
      )}
    </div>
  );
}

// ─── BOOT SCREEN ─────────────────────────────────────────────────────────────

function Boot({ onDone }) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState(0);
  const platforms = ["AliExpress","Alibaba","1688","Shopee","Mercado Livre","Amazon BR","Magalu","Facebook Ads","Google Trends"];

  useEffect(() => {
    let p = 0, ph = 0;
    const iv = setInterval(() => {
      p += Math.random() * 4 + 2;
      if (p >= 100) { clearInterval(iv); setProgress(100); setTimeout(onDone, 300); return; }
      setProgress(p);
      const np = Math.floor((p / 100) * platforms.length);
      if (np !== ph) { ph = np; setPhase(np); }
    }, 60);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${C.navy} 0%,#1A3A7A 50%,#0F2356 100%)`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Sora,system-ui,sans-serif",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",inset:0,backgroundImage:"radial-gradient(circle at 50% 50%,rgba(26,86,219,0.06) 1px,transparent 1px)",backgroundSize:"32px 32px"}}/>
      <div style={{textAlign:"center",position:"relative",zIndex:1,width:"100%",maxWidth:480,padding:"0 20px"}}>
        <div style={{width:72,height:72,background:"linear-gradient(135deg,#1A56DB,#38BDF8)",borderRadius:20,display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,margin:"0 auto 20px"}}>⚡</div>
        <div style={{fontSize:38,fontWeight:900,color:"#fff",letterSpacing:-1.5,marginBottom:4}}>NEXO</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,0.4)",letterSpacing:2,marginBottom:40}}>PRODUCT INTELLIGENCE</div>
        <div style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:14,padding:"14px 20px",marginBottom:28,textAlign:"left"}}>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",marginBottom:10,letterSpacing:1}}>CONECTANDO FONTES</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {platforms.map((pl,i)=>(
              <span key={pl} style={{fontSize:10,padding:"3px 8px",borderRadius:6,fontWeight:600,background:i<phase?"rgba(34,197,94,0.15)":i===phase?"rgba(26,86,219,0.25)":"rgba(255,255,255,0.04)",color:i<phase?"#4ADE80":i===phase?"#93C5FD":"rgba(255,255,255,0.3)",transition:"all 0.3s"}}>
                {i<phase?"✓ ":i===phase?"⟳ ":""}{pl}
              </span>
            ))}
          </div>
        </div>
        <div style={{background:"rgba(255,255,255,0.08)",borderRadius:99,height:6,overflow:"hidden",marginBottom:12}}>
          <div style={{height:"100%",background:"linear-gradient(90deg,#1A56DB,#38BDF8)",borderRadius:99,width:`${progress}%`,transition:"width 0.1s linear"}}/>
        </div>
        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:22,fontWeight:600,color:"rgba(255,255,255,0.9)"}}>{Math.round(progress)}%</div>
      </div>
    </div>
  );
}

// ─── AI RIGHT DRAWER ─────────────────────────────────────────────────────────

function AIDrawer({ product, onClose, onOpenFull }) {
  const p = normalizeProduct(product);
  const [ai, setAi] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAi(null); setLoading(true);
    apiFetch(`/api/ai/analyze/${p.id}`, { method:"POST" })
      .then(d => setAi(d))
      .catch(e => setAi({ error: e.message }))
      .finally(() => setLoading(false));
  }, [p.id]);

  const scoreBr = ai?.score_br ?? ai?.nota ?? null;
  const compLvl = ai?.competition_lvl ?? (p.brStatus === "Não Vendido" ? "Baixa" : p.brStatus === "Pouco Vendido" ? "Média" : "Alta");
  const hook = ai?.ad_creative_hook ?? ai?.copys?.[0] ?? null;
  const proj = ai?.sales_projection ?? null;
  const compColor = compLvl === "Baixa" ? C.green : compLvl === "Média" ? C.yellow : C.red;
  const compBg   = compLvl === "Baixa" ? C.greenLight : compLvl === "Média" ? C.yellowLight : C.redLight;

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:500,backdropFilter:"blur(2px)"}}/>
      {/* Drawer */}
      <div style={{position:"fixed",top:0,right:0,bottom:0,width:360,background:C.surface,borderLeft:`1px solid ${C.border}`,zIndex:501,display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"-16px 0 48px rgba(0,0,0,0.5)"}}>
        {/* Header */}
        <div style={{background:`linear-gradient(135deg,#010409,${C.sidebarActive})`,padding:"18px 20px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexShrink:0}}>
          <div style={{flex:1,minWidth:0,marginRight:12}}>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",letterSpacing:1,marginBottom:4}}>🤖 PARECER DA IA</div>
            <div style={{fontSize:14,fontWeight:700,color:"#fff",lineHeight:1.3,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{p.name}</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.1)",border:"none",borderRadius:8,padding:"6px 10px",color:"#fff",cursor:"pointer",fontSize:16,flexShrink:0}}>✕</button>
        </div>
        {/* Content */}
        <div style={{flex:1,overflowY:"auto",padding:20}}>
          {loading ? (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"48px 0",gap:14}}>
              <div style={{width:32,height:32,border:`3px solid ${C.blueLight}`,borderTopColor:C.blue,borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
              <span style={{fontSize:13,color:C.textSub}}>IA analisando produto…</span>
            </div>
          ) : (
            <>
              {ai?.error && <div style={{background:C.redLight,color:C.red,borderRadius:8,padding:"8px 12px",fontSize:12,marginBottom:16}}>{ai.error}</div>}

              {/* Score BR */}
              {scoreBr != null && (
                <div style={{background:C.bg,borderRadius:12,padding:16,marginBottom:12,border:`1px solid ${C.border}`}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.textSub,marginBottom:8,letterSpacing:0.5}}>POTENCIAL NO BRASIL</div>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <div style={{fontSize:32,fontWeight:900,color:scoreBr>=75?C.green:scoreBr>=50?C.yellow:C.red}}>{scoreBr}/100</div>
                    <div style={{flex:1}}>
                      <div style={{height:6,background:C.border,borderRadius:99,overflow:"hidden"}}>
                        <div style={{width:`${scoreBr}%`,height:"100%",background:scoreBr>=75?C.green:scoreBr>=50?C.yellow:C.red,borderRadius:99}}/>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Competition */}
              <div style={{background:C.bg,borderRadius:12,padding:16,marginBottom:12,border:`1px solid ${C.border}`}}>
                <div style={{fontSize:11,fontWeight:700,color:C.textSub,marginBottom:8,letterSpacing:0.5}}>CONCORRÊNCIA</div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{background:compBg,color:compColor,borderRadius:8,padding:"4px 12px",fontSize:13,fontWeight:800}}>{compLvl}</span>
                  <span style={{fontSize:12,color:C.textSub}}>{p.brStatus} no BR</span>
                </div>
              </div>

              {/* Hook */}
              {hook && (
                <div style={{background:C.blueLight,borderRadius:12,padding:16,marginBottom:12,border:`1px solid ${C.blueMid}`}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.blue,marginBottom:8,letterSpacing:0.5}}>🎯 HOOK PARA TIKTOK/FB</div>
                  <div style={{fontSize:13,color:C.text,lineHeight:1.6,fontStyle:"italic"}}>"{hook}"</div>
                </div>
              )}

              {/* Sales Projection */}
              {proj && (
                <div style={{background:C.greenLight,borderRadius:12,padding:16,marginBottom:12,border:`1px solid ${C.green}33`}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.green,marginBottom:8,letterSpacing:0.5}}>📈 PROJEÇÃO 30 DIAS</div>
                  <div style={{fontSize:13,color:C.text,lineHeight:1.6}}>{proj}</div>
                </div>
              )}

              {/* Headline */}
              {ai?.headline && (
                <div style={{background:C.bg,borderRadius:12,padding:16,marginBottom:12,border:`1px solid ${C.border}`}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.textSub,marginBottom:6,letterSpacing:0.5}}>ANÁLISE GERAL</div>
                  <div style={{fontSize:13,color:C.textMid,lineHeight:1.65}}>{ai.headline}</div>
                </div>
              )}

              {/* Strategy */}
              {ai?.estrategia && (
                <div style={{background:C.bg,borderRadius:12,padding:16,marginBottom:12,border:`1px solid ${C.border}`}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.textSub,marginBottom:6,letterSpacing:0.5}}>🚀 ESTRATÉGIA</div>
                  <div style={{fontSize:12,color:C.textMid,lineHeight:1.65}}>{ai.estrategia}</div>
                </div>
              )}

              {!ai && !loading && (
                <div style={{textAlign:"center",padding:"32px 0",color:C.textSub,fontSize:13}}>Sem dados da IA disponíveis.</div>
              )}
            </>
          )}
        </div>
        {/* Footer */}
        <div style={{padding:"14px 20px",borderTop:`1px solid ${C.border}`,display:"flex",gap:8,flexShrink:0}}>
          <button onClick={onOpenFull} style={{flex:1,padding:"9px",borderRadius:9,border:`1px solid ${C.blue}`,background:C.blueLight,color:C.blue,fontSize:12,fontWeight:700,cursor:"pointer"}}>Ver Análise Completa ↗</button>
          <button onClick={onClose} style={{padding:"9px 14px",borderRadius:9,border:`1px solid ${C.border}`,background:C.bg,color:C.textSub,fontSize:12,cursor:"pointer"}}>Fechar</button>
        </div>
      </div>
    </>
  );
}

// ─── META ADS INTELLIGENCE ────────────────────────────────────────────────────

// ── Demo data ─────────────────────────────────────────────────────────────────
const META_DEMO_CAMPAIGNS = [
  { id:"c1", name:"Saúde & Beleza — Conversão", status:"ACTIVE", objective:"OUTCOME_SALES", daily_budget:50, spend:1247.80, impressions:84320, clicks:1012, ctr:1.20, cpm:14.80, cpc:1.23, reach:61200, frequency:1.38, purchases:41, revenue:3726.50, purchase_roas:2.99 },
  { id:"c2", name:"Pet — Tráfego Frio Lookalike", status:"ACTIVE", objective:"OUTCOME_TRAFFIC", daily_budget:30, spend:689.40, impressions:52110, clicks:572, ctr:1.10, cpm:13.23, cpc:1.21, reach:44800, frequency:1.16, purchases:18, revenue:918.00, purchase_roas:1.33 },
  { id:"c3", name:"Fitness — Remarketing 7d", status:"ACTIVE", objective:"OUTCOME_SALES", daily_budget:20, spend:312.00, impressions:18900, clicks:378, ctr:2.00, cpm:16.51, cpc:0.83, reach:14200, frequency:1.33, purchases:22, revenue:1540.00, purchase_roas:4.94 },
  { id:"c4", name:"Cozinha — Engajamento", status:"PAUSED", objective:"OUTCOME_ENGAGEMENT", daily_budget:15, spend:88.50, impressions:22400, clicks:134, ctr:0.60, cpm:3.95, cpc:0.66, reach:19800, frequency:1.13, purchases:2, revenue:96.00, purchase_roas:1.08 },
];
const META_DEMO_ADS = [
  { id:"a1", name:"Video UGC — Antes/Depois Skincare 30s", status:"ACTIVE", effective_status:"ACTIVE", badge:"ESCALAVEL", thumbnail_url:"https://images.unsplash.com/photo-1596755389378-c31d21fd1273?w=400", spend:624.30, impressions:42800, clicks:684, ctr:1.60, cpm:14.59, cpc:0.91, reach:34200, frequency:1.25, purchases:28, purchase_roas:3.82, cost_per_purchase:22.30, play_rate_pct:34.2, completion_rate_pct:22.8, video_id:"demo" },
  { id:"a2", name:"Imagem Produto — Oferta 50% OFF", status:"ACTIVE", effective_status:"ACTIVE", badge:"ESTAVEL", thumbnail_url:"https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=400", spend:389.10, impressions:28600, clicks:314, ctr:1.10, cpm:13.60, cpc:1.24, reach:22400, frequency:1.28, purchases:13, purchase_roas:2.21, play_rate_pct:0, completion_rate_pct:0 },
  { id:"a3", name:"Carrossel — 5 Produtos Pet", status:"ACTIVE", effective_status:"ACTIVE", badge:"ATENCAO", thumbnail_url:"https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=400", spend:234.80, impressions:18900, clicks:132, ctr:0.70, cpm:12.43, cpc:1.78, reach:15800, frequency:1.20, purchases:6, purchase_roas:1.53, play_rate_pct:0, completion_rate_pct:0 },
  { id:"a4", name:"Reels Fitness — Hook Polêmico 15s", status:"ACTIVE", effective_status:"ACTIVE", badge:"ESCALAVEL", thumbnail_url:"https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400", spend:312.00, impressions:18900, clicks:378, ctr:2.00, cpm:16.51, cpc:0.83, reach:14200, frequency:1.33, purchases:22, purchase_roas:4.94, play_rate_pct:41.5, completion_rate_pct:27.3, video_id:"demo" },
  { id:"a5", name:"Imagem Estática — Cortador Legumes", status:"PAUSED", effective_status:"PAUSED", badge:"PAUSAR", thumbnail_url:"https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400", spend:88.50, impressions:22400, clicks:134, ctr:0.60, cpm:3.95, cpc:0.66, reach:19800, frequency:4.52, purchases:2, purchase_roas:1.08, play_rate_pct:0, completion_rate_pct:0 },
  { id:"a6", name:"Video Depoimento — Cliente Real 45s", status:"ACTIVE", effective_status:"ACTIVE", badge:"ESTAVEL", thumbnail_url:"https://images.unsplash.com/photo-1607748862156-7c548e7e98f4?w=400", spend:178.40, impressions:12300, clicks:172, ctr:1.40, cpm:14.50, cpc:1.04, reach:10200, frequency:1.21, purchases:9, purchase_roas:2.68, play_rate_pct:28.1, completion_rate_pct:18.4, video_id:"demo" },
];
const META_DEMO_INSIGHTS = { spend:2337.80, impressions:178030, clicks:1900, ctr:1.07, cpm:13.13, cpc:1.23, reach:134400, frequency:1.32, purchases:71, revenue:6280.50, purchase_roas:2.69, cost_per_purchase:32.93, play_rate_pct:27.6, account_name:"Conta Demo — NEXO", currency:"BRL" };
const META_DEMO_ANALYSIS = { demo:true, health_score:72, health_label:"Bom", summary:{critical:1,warnings:2,opportunities:2,campaigns_analyzed:4,ads_analyzed:6},
  issues:[
    {level:"crítico",entity:"campanha",entity_name:"Cozinha — Engajamento",metric:"ROAS",value:1.08,threshold:2,description:"Campanha com ROAS 1.08x — abaixo do break-even, gerando prejuízo",action:"Pause esta campanha imediatamente e redirecione o budget para 'Fitness — Remarketing' (ROAS 4.94x).",impact:"alto",priority:1},
    {level:"atenção",entity:"anúncio",entity_name:"Imagem Estática — Cortador",metric:"Frequência",value:4.52,threshold:3.0,description:"Frequência 4.52 — público saturado, vendo o mesmo anúncio muitas vezes",action:"Crie novo público lookalike ou pause o adset por 7 dias para resetar a frequência.",impact:"médio",priority:2},
    {level:"oportunidade",entity:"anúncio",entity_name:"Reels Fitness — Hook Polêmico",metric:"ROAS",value:4.94,threshold:3.0,description:"ROAS 4.94x e CTR 2.00% — candidato a escala agora",action:"Aumente o budget do adset em 20-30% a cada 48h. Não altere público nem criativos.",impact:"alto",priority:3},
  ],
  scale_now:[{id:"a4",name:"Reels Fitness — Hook Polêmico",roas:4.94,ctr:2.0}],
  pause_now:[{id:"c4",name:"Cozinha — Engajamento",spend:88.5,roas:1.08}],
  top_recommendations:["[CAMPANHA] Pause 'Cozinha — Engajamento' e redirecione budget para Fitness Remarketing.","[ANÚNCIO] Aumente budget do Reels Fitness em 20% agora — ROAS 4.94x.","[CONTA] Frequência 4.52 no Cortador — crie público novo ou pause por 7 dias."]
};

function MetaAdsBadge({ badge, demo }) {
  const map = {
    ESCALAVEL: { bg:C.greenLight,  color:C.green,  label:"▲ ESCALÁVEL" },
    ESTAVEL:   { bg:C.blueLight,   color:C.blue,   label:"● ESTÁVEL" },
    ATENCAO:   { bg:C.yellowLight, color:C.yellow, label:"⚠ ATENÇÃO" },
    PAUSAR:    { bg:C.redLight,    color:C.red,    label:"■ PAUSAR" },
    REPROVADO: { bg:C.redLight,    color:C.red,    label:"✕ REPROVADO" },
  };
  const s = map[badge] || map["ATENCAO"];
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
      <span style={{background:s.bg,color:s.color,borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:800,letterSpacing:0.3,border:`1px solid ${s.color}33`}}>{s.label}</span>
      {demo&&<span style={{background:"#2d2000",color:"#f0a500",borderRadius:4,padding:"1px 5px",fontSize:9,fontWeight:800}}>DEMO</span>}
    </span>
  );
}

function MetaMetricCard({ label, value, sub, color, icon, demo }) {
  return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:"18px 20px",flex:1,minWidth:130,position:"relative"}}>
      {demo&&<span style={{position:"absolute",top:8,right:8,background:"#2d2000",color:"#f0a500",borderRadius:4,padding:"1px 6px",fontSize:9,fontWeight:800}}>DEMO</span>}
      <div style={{fontSize:20,marginBottom:8}}>{icon}</div>
      <div style={{fontSize:22,fontWeight:900,color:color||C.text}}>{value}</div>
      <div style={{fontSize:11,color:C.textSub,marginTop:2}}>{label}</div>
      {sub&&<div style={{fontSize:10,color:C.textLight,marginTop:3}}>{sub}</div>}
    </div>
  );
}

function MetaIssueRow({ issue }) {
  const lv = (issue.level||"").toLowerCase();
  const colorMap = { "crítico":C.red,"critico":C.red,"atenção":C.yellow,"atencao":C.yellow,"oportunidade":C.green };
  const bgMap    = { "crítico":C.redLight,"critico":C.redLight,"atenção":C.yellowLight,"atencao":C.yellowLight,"oportunidade":C.greenLight };
  const iconMap  = { "crítico":"🔴","critico":"🔴","atenção":"🟡","atencao":"🟡","oportunidade":"🟢" };
  const color = colorMap[lv] || C.textSub;
  const bg    = bgMap[lv]    || C.surface;
  return (
    <div style={{border:`1px solid ${color}33`,borderLeft:`4px solid ${color}`,borderRadius:10,padding:"14px 18px",marginBottom:10,background:bg}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
        <span style={{fontSize:16,flexShrink:0}}>{iconMap[lv]||"⚠️"}</span>
        <div style={{flex:1}}>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
            <span style={{fontSize:11,fontWeight:800,color,textTransform:"uppercase",letterSpacing:0.5}}>{issue.level}</span>
            <span style={{fontSize:11,color:C.textLight,background:C.bg,borderRadius:4,padding:"1px 6px"}}>{issue.entity}: {issue.entity_name}</span>
            <span style={{fontSize:11,color:C.textLight}}>Métrica: <b style={{color:C.text}}>{issue.metric} {issue.value}</b></span>
          </div>
          <div style={{fontSize:13,color:C.text,marginBottom:6,fontWeight:600}}>{issue.description}</div>
          <div style={{fontSize:12,color:C.textSub,background:C.bg,borderRadius:8,padding:"8px 12px",borderLeft:`3px solid ${color}`}}>
            <span style={{fontWeight:700,color}}>Ação: </span>{issue.action}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaSetupModal({ onClose }) {
  const steps = [
    { n:1, title:"Acesse o Meta Business", desc:"Vá para business.facebook.com e faça login com a conta que gerencia seus anúncios." },
    { n:2, title:"Crie um System User (Administrador)", desc:"Menu lateral → Configurações → Usuários do Sistema → Adicionar. Tipo: Administrador." },
    { n:3, title:"Gere o Token de Acesso", desc:"Clique no System User criado → 'Gerar novo token'. Selecione um App existente ou crie em developers.facebook.com." },
    { n:4, title:"Marque as permissões obrigatórias", desc:"Selecione: ads_read e read_insights. Opcionais: ads_management, business_management." },
    { n:5, title:"Copie o Token (começa com EAA...)", desc:"Salve o token gerado com segurança. Nunca compartilhe publicamente." },
    { n:6, title:"Configure no Render", desc:"Render Dashboard → seu serviço nexo-backend → Environment → Add Variable: META_ADS_TOKEN = (seu token). Salve e aguarde o redeploy." },
  ];
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.surface,borderRadius:20,width:"100%",maxWidth:560,maxHeight:"90vh",overflowY:"auto",border:`1px solid ${C.border}`,boxShadow:"0 32px 80px rgba(0,0,0,0.6)"}}>
        <div style={{background:"linear-gradient(135deg,#1877F2,#0a52b8)",padding:"20px 24px",borderRadius:"20px 20px 0 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:18,fontWeight:900,color:"#fff"}}>🔧 Como configurar o Meta Ads</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.7)",marginTop:2}}>Passo a passo — 5 minutos</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",cursor:"pointer",fontSize:16}}>✕</button>
        </div>
        <div style={{padding:"24px"}}>
          {steps.map(s=>(
            <div key={s.n} style={{display:"flex",gap:14,marginBottom:20,alignItems:"flex-start"}}>
              <div style={{width:32,height:32,background:"#1877F2",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,color:"#fff",fontSize:14,flexShrink:0}}>{s.n}</div>
              <div><div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:4}}>{s.title}</div><div style={{fontSize:12,color:C.textSub,lineHeight:1.6}}>{s.desc}</div></div>
            </div>
          ))}
          <div style={{background:C.bg,borderRadius:12,padding:"14px 16px",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:11,fontWeight:700,color:C.blue,marginBottom:8}}>LINKS ÚTEIS</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[["🔗 Meta Business — System Users","https://business.facebook.com/settings/system-users"],["🔗 Meta Developers — Apps","https://developers.facebook.com/apps"],["🔗 Render Dashboard — Env Vars","https://dashboard.render.com"]].map(([label,url])=>(
                <a key={url} href={url} target="_blank" rel="noreferrer" style={{fontSize:12,color:C.blue,textDecoration:"none"}}>{label}</a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaAds() {
  const [tab, setTab]                       = useState("overview");
  const [loading, setLoading]               = useState(true);
  const [apiError, setApiError]             = useState(null);
  const [demoMode, setDemoMode]             = useState(false);
  const [showSetup, setShowSetup]           = useState(false);
  const [campaigns, setCampaigns]           = useState([]);
  const [ads, setAds]                       = useState([]);
  const [insights, setInsights]             = useState(null);
  const [analysis, setAnalysis]             = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [nexoProducts, setNexoProducts]     = useState([]);
  const [tokenStatus, setTokenStatus]       = useState(null); // null | "ok" | "missing"
  const [accountId, setAccountId]           = useState("");
  const [accounts, setAccounts]             = useState([]);
  const [adsets, setAdsets]                 = useState([]);
  const [lastUpdated, setLastUpdated]       = useState(null);

  const NICHE_CPM  = {"Saúde e Beleza":35,"Pet":28,"Fitness em Casa":30,"Casa Inteligente":32,"Bebês e Crianças":38,"Eletrônicos":40,"Cozinha":25};
  const NICHE_ROAS = {"Saúde e Beleza":"3-5x","Pet":"4-6x","Fitness em Casa":"3-4x","Casa Inteligente":"3-4x","Bebês e Crianças":"3-5x","Eletrônicos":"2-4x","Cozinha":"3-5x"};

  useEffect(()=>{
    checkToken();
    apiFetch("/api/products?limit=8").then(d=>setNexoProducts((d?.products||[]).map(normalizeProduct))).catch(()=>{});
  },[]);

  async function checkToken() {
    try {
      const cfg = await apiFetch("/api/meta/config");
      setTokenStatus(cfg?.configured ? "ok" : "missing");
      if (cfg?.configured) loadData();
      else {
        setDemoMode(true);
        setInsights(META_DEMO_INSIGHTS); setCampaigns(META_DEMO_CAMPAIGNS); setAds(META_DEMO_ADS);
        setLoading(false);
      }
    } catch { loadData(); }
  }

  async function loadData(accId) {
    setLoading(true); setApiError(null); setDemoMode(false);
    const q = accId||accountId ? `?account_id=${accId||accountId}` : "";
    try {
      const [ins, camp, adsData, accs, setsData] = await Promise.all([
        apiFetch(`/api/meta/insights${q}`),
        apiFetch(`/api/meta/campaigns${q}`),
        apiFetch(`/api/meta/ads${q}`),
        apiFetch("/api/meta/accounts"),
        apiFetch(`/api/meta/adsets${q}`),
      ]);
      setInsights(ins);
      setCampaigns(camp?.campaigns||[]);
      setAds(adsData?.ads||[]);
      setAccounts(accs?.accounts||[]);
      setAdsets(setsData?.adsets||[]);
      if (!accId&&!accountId && camp?.account_id) setAccountId(camp.account_id);
      setTokenStatus("ok");
      setLastUpdated(new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}));
    } catch(e) {
      let detail = null;
      try { const m = e.message.match(/\{.+\}/s); if(m) detail = JSON.parse(m[0]); } catch {}
      setApiError({ message:e.message, detail });
      setDemoMode(true);
      setInsights(META_DEMO_INSIGHTS); setCampaigns(META_DEMO_CAMPAIGNS); setAds(META_DEMO_ADS);
    }
    setLoading(false);
  }

  async function runAnalysis() {
    if (demoMode) { setAnalysis(META_DEMO_ANALYSIS); setTab("diagnostic"); return; }
    setAnalysisLoading(true); setTab("diagnostic");
    try { const res = await apiFetch("/api/meta/analysis"); setAnalysis(res); }
    catch(e) { setAnalysis({error:e.message}); }
    setAnalysisLoading(false);
  }

  const fmt_brl = v => v!=null ? `R$${parseFloat(v).toFixed(2)}` : "—";
  const fmt_pct = v => v!=null ? `${parseFloat(v).toFixed(2)}%` : "—";
  const fmt_x   = v => v!=null ? `${parseFloat(v).toFixed(2)}x` : "—";

  const TABS = [
    {id:"overview",      label:"📈 Visão Geral"},
    {id:"adsets",        label:"🎯 Conjuntos"},
    {id:"ads",           label:"🎞 Anúncios"},
    {id:"diagnostic",    label:"🤖 Diagnóstico IA"},
    {id:"opportunities", label:"💡 Oportunidades"},
  ];

  if (loading) return <div style={{padding:40}}><Spinner text="Conectando ao Meta Ads…"/></div>;

  return (
    <div>
      {showSetup&&<MetaSetupModal onClose={()=>setShowSetup(false)}/>}

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:4}}>
            <div style={{fontSize:22,fontWeight:900,color:C.text,letterSpacing:-0.5}}>📊 Meta Ads Intelligence</div>
            {!demoMode&&tokenStatus==="ok"&&(
              <span style={{background:C.greenLight,color:C.green,border:`1px solid ${C.green}44`,borderRadius:6,padding:"2px 10px",fontSize:11,fontWeight:800}}>● CONECTADO</span>
            )}
            {demoMode&&<span style={{background:"#2d2000",color:"#f0a500",borderRadius:6,padding:"3px 9px",fontSize:11,fontWeight:800}}>DEMO</span>}
          </div>
          <div style={{fontSize:13,color:C.textSub}}>
            {!demoMode&&insights?.account_name ? `Conta: ${insights.account_name} (${insights.currency||"BRL"})` : "Análise em tempo real — últimos 30 dias"}
            {lastUpdated&&<span style={{marginLeft:8,fontSize:11,color:C.textLight}}>• Atualizado às {lastUpdated}</span>}
          </div>
          {accounts.length>1&&(
            <select value={accountId} onChange={e=>{setAccountId(e.target.value);loadData(e.target.value);}} style={{marginTop:8,background:C.surface,color:C.text,border:`1px solid ${C.border}`,borderRadius:8,padding:"5px 10px",fontSize:12,cursor:"pointer"}}>
              {accounts.map(a=><option key={a.id} value={a.id}>{a.name||a.account_id} ({a.currency})</option>)}
            </select>
          )}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <Btn variant="ghost" onClick={()=>setShowSetup(true)} icon="❓" small>Como configurar</Btn>
          <Btn variant="ghost" onClick={()=>loadData()} icon="🔄" small>Atualizar</Btn>
          <Btn variant="primary" onClick={runAnalysis} icon="🤖" small disabled={analysisLoading}>
            {analysisLoading?"Analisando…":"Analisar com IA"}
          </Btn>
        </div>
      </div>

      {/* Banner erro/configuração */}
      {apiError&&(
        <div style={{background:"#1a0f00",border:"1px solid #f0a50055",borderRadius:14,padding:"16px 20px",marginBottom:20}}>
          <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
            <span style={{fontSize:24,flexShrink:0}}>🔐</span>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:800,color:"#f0a500",marginBottom:4}}>
                {apiError.detail?.error_type==="TOKEN_NOT_CONFIGURED" ? "Token Meta Ads não configurado" : "Erro de acesso à API do Meta"}
              </div>
              {apiError.detail?.error_code&&<div style={{fontSize:11,color:"#b1854a",marginBottom:6}}>Código: {apiError.detail.error_code} — {apiError.detail.hint}</div>}
              <div style={{fontSize:12,color:"#8b6330",background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 14px",marginBottom:10,lineHeight:1.7}}>
                Para usar o Meta Ads Intelligence, gere um token em <b style={{color:"#f0a500"}}>business.facebook.com</b> com as permissões: <b style={{color:"#f0a500"}}>ads_read</b> e <b style={{color:"#f0a500"}}>read_insights</b>. Em seguida, adicione <b style={{color:"#f0a500"}}>META_ADS_TOKEN</b> nas variáveis de ambiente do Render.
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <Btn onClick={()=>setShowSetup(true)} variant="ghost" icon="📖" small>Ver passo a passo</Btn>
                <Btn href="https://business.facebook.com/settings/system-users" variant="fb" small icon="🔗">Meta Business</Btn>
                <Btn href="https://dashboard.render.com" variant="outline" small icon="⚙️">Render Dashboard</Btn>
              </div>
            </div>
            <div style={{background:"rgba(240,165,0,0.12)",border:"1px solid #f0a50033",borderRadius:10,padding:"10px 16px",fontSize:12,color:"#f0a500",textAlign:"center",flexShrink:0}}>
              <div style={{fontWeight:700,marginBottom:2}}>Exibindo</div>
              <div style={{fontSize:20,fontWeight:900}}>DEMO</div>
              <div style={{fontSize:10,color:"#8b6330"}}>dados simulados</div>
            </div>
          </div>
        </div>
      )}

      {/* Cards métricas consolidadas */}
      {insights&&(
        <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
          <MetaMetricCard icon="💸" label="Gasto Total (30d)"  value={fmt_brl(insights.spend)}          color={C.text}  demo={demoMode}/>
          <MetaMetricCard icon="📊" label="ROAS Médio"         value={fmt_x(insights.purchase_roas)}     color={insights.purchase_roas>=2?C.green:C.red} demo={demoMode}/>
          <MetaMetricCard icon="📡" label="CPM Médio"          value={fmt_brl(insights.cpm)}             color={insights.cpm>50?C.yellow:C.text} demo={demoMode}/>
          <MetaMetricCard icon="👆" label="CTR Médio"          value={fmt_pct(insights.ctr)}             color={insights.ctr>=1?C.green:C.yellow} demo={demoMode}/>
          <MetaMetricCard icon="👁" label="Alcance"            value={(insights.reach||0).toLocaleString("pt-BR")} color={C.blue} demo={demoMode}/>
          <MetaMetricCard icon="🔁" label="Frequência"         value={(insights.frequency||0).toFixed(1)} color={insights.frequency>3?C.red:C.text} demo={demoMode}/>
        </div>
      )}

      {/* Tabs */}
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,marginBottom:20,overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"none",border:"none",borderBottom:`2px solid ${tab===t.id?C.blue:"transparent"}`,padding:"11px 18px",fontSize:13,fontWeight:tab===t.id?700:500,color:tab===t.id?C.blue:C.textSub,cursor:"pointer",marginBottom:-1,whiteSpace:"nowrap"}}>{t.label}</button>
        ))}
      </div>

      {/* ABA 1 — VISÃO GERAL */}
      {tab==="overview"&&(
        <div>
          <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:14}}>🏆 Ranking de Campanhas por ROAS {demoMode&&<span style={{fontSize:11,color:"#f0a500",fontWeight:600}}>(demo)</span>}</div>
          {campaigns.length===0&&<EmptyState icon="📭" title="Sem dados de campanha" sub="Verifique se o token tem permissão ads_read"/>}
          {campaigns.map((c,i)=>(
            <div key={c.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"14px 18px",marginBottom:10,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
              <div style={{width:28,height:28,background:i<3?C.blueLight:C.bg,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,color:i<3?C.blue:C.textSub,fontSize:13,flexShrink:0}}>#{i+1}</div>
              <div style={{flex:2,minWidth:160}}>
                <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:4}}>{c.name}</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <Tag color={c.status==="ACTIVE"?"green":"gray"} sm>{c.status}</Tag>
                  {c.objective&&<Tag color="blue" sm>{c.objective}</Tag>}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,80px)",gap:10,flexShrink:0}}>
                {[{l:"Gasto",v:fmt_brl(c.spend)},{l:"ROAS",v:fmt_x(c.purchase_roas),hl:c.purchase_roas>=2},{l:"CTR",v:fmt_pct(c.ctr),hl:c.ctr>=1},{l:"CPM",v:fmt_brl(c.cpm)}].map(m=>(
                  <div key={m.l} style={{textAlign:"center"}}>
                    <div style={{fontSize:13,fontWeight:800,color:m.hl?C.green:C.text}}>{m.v||"—"}</div>
                    <div style={{fontSize:10,color:C.textLight}}>{m.l}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ABA — CONJUNTOS (AD SETS) */}
      {tab==="adsets"&&(
        <div>
          <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:14}}>🎯 Conjuntos de Anúncios {demoMode&&<span style={{fontSize:11,color:"#f0a500"}}>(demo)</span>}</div>
          {adsets.length===0&&<EmptyState icon="🎯" title="Nenhum conjunto encontrado" sub="Verifique as permissões do token"/>}
          {adsets.map((s,i)=>(
            <div key={s.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"14px 18px",marginBottom:10,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
              <div style={{width:28,height:28,background:i<3?C.blueLight:C.bg,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,color:i<3?C.blue:C.textSub,fontSize:13,flexShrink:0}}>#{i+1}</div>
              <div style={{flex:2,minWidth:160}}>
                <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:4}}>{s.name}</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <Tag color={s.status==="ACTIVE"?"green":"gray"} sm>{s.status}</Tag>
                  {s.optimization_goal&&<Tag color="blue" sm>{s.optimization_goal}</Tag>}
                  {s.bid_strategy&&<Tag color="purple" sm>{s.bid_strategy}</Tag>}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,72px)",gap:10,flexShrink:0}}>
                {[
                  {l:"Gasto",    v:`R$${parseFloat(s.spend||0).toFixed(0)}`},
                  {l:"ROAS",     v:s.purchase_roas?`${parseFloat(s.purchase_roas).toFixed(2)}x`:"—", hl:(s.purchase_roas||0)>=2},
                  {l:"CTR",      v:s.ctr?`${parseFloat(s.ctr).toFixed(2)}%`:"—", hl:(s.ctr||0)>=1},
                  {l:"CPM",      v:s.cpm?`R$${parseFloat(s.cpm).toFixed(0)}`:"—"},
                  {l:"Orçam./d", v:s.daily_budget?`R$${parseFloat(s.daily_budget).toFixed(0)}`:"—"},
                ].map(m=>(
                  <div key={m.l} style={{textAlign:"center"}}>
                    <div style={{fontSize:13,fontWeight:800,color:m.hl?C.green:C.text}}>{m.v}</div>
                    <div style={{fontSize:10,color:C.textLight}}>{m.l}</div>
                  </div>
                ))}
              </div>
              {(s.age_min||s.age_max)&&(
                <div style={{background:C.bg,borderRadius:8,padding:"6px 10px",fontSize:11,color:C.textSub,flexShrink:0}}>
                  Idade: {s.age_min||"?"}–{s.age_max||"?"}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ABA 2 — ANÚNCIOS */}
      {tab==="ads"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div style={{fontSize:15,fontWeight:700,color:C.text}}>{ads.length} anúncios {demoMode&&<span style={{fontSize:11,color:"#f0a500"}}>(demo)</span>}</div>
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
              {["ESCALAVEL","ESTAVEL","ATENCAO","PAUSAR"].map(b=><MetaAdsBadge key={b} badge={b}/>)}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
            {ads.map(a=>{
              const fallback="https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=400";
              const thumb=a.thumbnail_url||a.image_url||fallback;
              return (
                <div key={a.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
                  <div style={{position:"relative",height:140,background:C.bg}}>
                    <img src={thumb} alt={a.name} onError={e=>e.target.src=fallback} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                    <div style={{position:"absolute",top:8,left:8}}><MetaAdsBadge badge={a.badge} demo={demoMode}/></div>
                    {a.video_id&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:36,height:36,background:"rgba(255,255,255,0.85)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>▶</div></div>}
                  </div>
                  <div style={{padding:"14px 16px"}}>
                    <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:10,lineHeight:1.4}}>{a.name}</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                      {[{l:"Gasto",v:fmt_brl(a.spend)},{l:"ROAS",v:fmt_x(a.purchase_roas),hl:a.purchase_roas>=2},{l:"CTR",v:fmt_pct(a.ctr),hl:a.ctr>=1},{l:"CPM",v:fmt_brl(a.cpm)},{l:"Frequência",v:(a.frequency||0).toFixed(1),hl:(a.frequency||0)<3},{l:"CPC",v:fmt_brl(a.cpc)}].map(m=>(
                        <div key={m.l} style={{background:C.bg,borderRadius:8,padding:"7px 10px",textAlign:"center"}}>
                          <div style={{fontSize:13,fontWeight:800,color:m.hl?C.green:C.text}}>{m.v||"—"}</div>
                          <div style={{fontSize:9,color:C.textLight,marginTop:1}}>{m.l}</div>
                        </div>
                      ))}
                    </div>
                    {(a.video_id||a.play_rate_pct>0)&&(
                      <div style={{background:C.bg,borderRadius:8,padding:"7px 10px",fontSize:11,color:C.textSub}}>
                        <span style={{fontWeight:700,color:C.text}}>Play rate: </span>{a.play_rate_pct||0}% &nbsp;|&nbsp;
                        <span style={{fontWeight:700,color:C.text}}>Conclusão: </span>{a.completion_rate_pct||0}%
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ABA 3 — DIAGNÓSTICO IA */}
      {tab==="diagnostic"&&(
        <div>
          {!analysis&&!analysisLoading&&(
            <div style={{textAlign:"center",padding:"50px 20px"}}>
              <div style={{fontSize:52,marginBottom:14}}>🤖</div>
              <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:8}}>Diagnóstico com IA</div>
              <div style={{fontSize:13,color:C.textSub,marginBottom:20}}>Análise completa das suas campanhas e anúncios{demoMode?" (com dados demo)":""}</div>
              <Btn onClick={runAnalysis} icon="🚀">Iniciar Diagnóstico{demoMode?" Demo":""}</Btn>
            </div>
          )}
          {analysisLoading&&<Spinner text="IA analisando suas campanhas…"/>}
          {analysis?.error&&<div style={{background:C.redLight,border:`1px solid ${C.red}`,borderRadius:12,padding:"16px 20px",color:C.red}}>{analysis.error}</div>}
          {analysis&&!analysis.error&&(
            <div>
              {analysis.demo&&<div style={{background:"#1a1000",border:"1px solid #f0a50044",borderRadius:10,padding:"10px 16px",marginBottom:16,fontSize:12,color:"#f0a500",fontWeight:600}}>Diagnóstico de demonstração — conecte seu token para análise real da sua conta</div>}
              <div style={{background:`linear-gradient(135deg,${C.surface},${C.blueLight})`,border:`1px solid ${C.border}`,borderRadius:16,padding:"20px 24px",marginBottom:20,display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
                <Ring val={analysis.health_score} size={72} stroke={analysis.health_score>=70?C.green:analysis.health_score>=50?C.yellow:C.red} bg={C.bg}/>
                <div>
                  <div style={{fontSize:14,color:C.textSub,marginBottom:4}}>Score de Saúde da Conta</div>
                  <div style={{fontSize:24,fontWeight:900,color:analysis.health_score>=70?C.green:analysis.health_score>=50?C.yellow:C.red}}>{analysis.health_label}</div>
                  <div style={{fontSize:12,color:C.textSub,marginTop:4}}>
                    {analysis.summary?.critical||0} crítico(s) &nbsp;•&nbsp; {analysis.summary?.warnings||0} atenção &nbsp;•&nbsp; {analysis.summary?.opportunities||0} oportunidade(s)
                  </div>
                </div>
                {analysis.scale_now?.length>0&&(
                  <div style={{marginLeft:"auto",background:C.greenLight,border:`1px solid ${C.green}33`,borderRadius:12,padding:"12px 16px"}}>
                    <div style={{fontSize:11,fontWeight:700,color:C.green,marginBottom:6}}>▲ ESCALAR AGORA</div>
                    {analysis.scale_now.slice(0,2).map(a=><div key={a.id} style={{fontSize:12,color:C.textSub}}>{a.name?.slice(0,28)} — ROAS {a.roas?.toFixed(1)}x</div>)}
                  </div>
                )}
                {analysis.pause_now?.length>0&&(
                  <div style={{background:C.redLight,border:`1px solid ${C.red}33`,borderRadius:12,padding:"12px 16px"}}>
                    <div style={{fontSize:11,fontWeight:700,color:C.red,marginBottom:6}}>■ PAUSAR AGORA</div>
                    {analysis.pause_now.slice(0,2).map(a=><div key={a.id} style={{fontSize:12,color:C.textSub}}>{a.name?.slice(0,28)} — R${a.spend}</div>)}
                  </div>
                )}
              </div>
              {analysis.top_recommendations?.length>0&&(
                <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:"16px 20px",marginBottom:20}}>
                  <div style={{fontSize:13,fontWeight:800,color:C.text,marginBottom:12}}>⚡ Top Recomendações Prioritárias</div>
                  {analysis.top_recommendations.map((r,i)=>(
                    <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"8px 0",borderBottom:i<analysis.top_recommendations.length-1?`1px solid ${C.border}`:"none"}}>
                      <span style={{background:C.blueLight,color:C.blue,borderRadius:6,padding:"2px 7px",fontSize:11,fontWeight:800,flexShrink:0}}>#{i+1}</span>
                      <span style={{fontSize:12,color:C.textSub,lineHeight:1.5}}>{r}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:12}}>Problemas Encontrados ({analysis.issues?.length||0})</div>
              {(analysis.issues||[]).map((issue,i)=><MetaIssueRow key={i} issue={issue}/>)}
              {(analysis.issues||[]).length===0&&<EmptyState icon="✅" title="Conta saudável!" sub="Nenhum problema crítico detectado"/>}
            </div>
          )}
        </div>
      )}

      {/* ABA 4 — OPORTUNIDADES */}
      {tab==="opportunities"&&(
        <div>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:"16px 20px",marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:6}}>💡 Produtos NEXO com Potencial para Meta Ads</div>
            <div style={{fontSize:12,color:C.textSub}}>CPM e ROAS estimados por nicho. Variam conforme criativo e público.</div>
          </div>
          {nexoProducts.length===0&&<Spinner text="Carregando produtos…"/>}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))",gap:14}}>
            {nexoProducts.map(p=>{
              const cpm=NICHE_CPM[p.category]||35;
              const roas=NICHE_ROAS[p.category]||"3-4x";
              const breakeven=p.markup>0?(1/(1-1/p.markup)).toFixed(2):"—";
              const pub={"Saúde e Beleza":"Mulheres 25-45, beleza/skin care","Pet":"Donos de pets 18-45","Fitness em Casa":"Adultos 22-40, academia","Casa Inteligente":"Adultos 28-50, decoração","Bebês e Crianças":"Pais 25-40, maternidade","Eletrônicos":"Adultos 18-45, tecnologia","Cozinha":"Adultos 25-50, culinária"}[p.category]||"Adultos 20-45";
              return (
                <div key={p.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
                  <div style={{height:110,overflow:"hidden"}}><img src={p.img} alt={p.name} onError={e=>e.target.src="https://images.unsplash.com/photo-1518770660439-4636190af475?w=400"} style={{width:"100%",height:"100%",objectFit:"cover"}}/></div>
                  <div style={{padding:"14px 16px"}}>
                    <Tag color="blue" sm>{p.category}</Tag>
                    <div style={{fontSize:13,fontWeight:700,color:C.text,margin:"8px 0 10px",lineHeight:1.3}}>{p.name.slice(0,55)}</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                      <div style={{background:C.bg,borderRadius:8,padding:"8px",textAlign:"center"}}><div style={{fontSize:13,fontWeight:800,color:C.blue}}>R${cpm}</div><div style={{fontSize:9,color:C.textLight}}>CPM estim.</div></div>
                      <div style={{background:C.bg,borderRadius:8,padding:"8px",textAlign:"center"}}><div style={{fontSize:13,fontWeight:800,color:C.green}}>{roas}</div><div style={{fontSize:9,color:C.textLight}}>ROAS estim.</div></div>
                      <div style={{background:C.bg,borderRadius:8,padding:"8px",textAlign:"center"}}><div style={{fontSize:13,fontWeight:800,color:C.yellow}}>{breakeven}x</div><div style={{fontSize:9,color:C.textLight}}>Break-even</div></div>
                    </div>
                    <div style={{background:C.blueLight,borderRadius:8,padding:"7px 10px",fontSize:11,color:C.textSub,marginBottom:10}}><span style={{fontWeight:700,color:C.blue}}>Público: </span>{pub}</div>
                    <Btn href={p._raw?.fb_ads_url||`https://www.facebook.com/ads/library/?q=${encodeURIComponent(p.name.slice(0,30))}`} variant="fb" small icon="🔍">Spy Ads</Btn>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── NAV CONFIG ───────────────────────────────────────────────────────────────

const NAV = [
  {id:"dashboard",icon:"⚡",label:"Dashboard"},
  {id:"produtos",icon:"🏆",label:"Winning Products"},
  {id:"radar",icon:"📡",label:"Trend Radar"},
  {id:"ads",icon:"📢",label:"Ads Spy"},
  {id:"gap",icon:"🎯",label:"Market Gap"},
  {id:"calc",icon:"💰",label:"Profit Calculator"},
  {id:"download",icon:"⬇️",label:"Criativos"},
  {id:"meta",icon:"📊",label:"Meta Ads"},
  {id:"favoritos",icon:"★",label:"Favoritos"},
  {id:"settings",icon:"⚙️",label:"Configurações"},
];

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function NexoApp() {
  const [authed, setAuthed] = useState(!!localStorage.getItem("nexo_token"));
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem("nexo_user")||"null"); } catch { return null; }});
  const [booted, setBooted] = useState(false);
  const [nav, setNav] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [favorites, setFavorites] = useState([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (isMobile) setCollapsed(true);
  }, [isMobile]);

  useEffect(() => {
    if (!authed) return;
    // Load favorites
    apiFetch("/api/products/favorites").then(d => setFavorites((d?.favorites||[]).map(p=>p.id))).catch(()=>{});
    // Load unread notifications count
    apiFetch("/api/notifications?limit=50").then(d => setUnreadCount((d?.notifications||[]).filter(n=>!n.is_read).length)).catch(()=>{});
  }, [authed]);

  function handleAuth(u) { setUser(u); setAuthed(true); }

  function logout() {
    localStorage.removeItem("nexo_token");
    localStorage.removeItem("nexo_user");
    setAuthed(false); setUser(null); setBooted(false);
  }

  async function toggleFav(productId) {
    try {
      const res = await apiFetch(`/api/products/${productId}/favorite`, { method:"POST" });
      if (res?.favorited) {
        setFavorites(f=>[...f,productId]);
      } else {
        setFavorites(f=>f.filter(id=>id!==productId));
      }
    } catch(e) {}
  }

  if (!authed) return <AuthScreen onAuth={handleAuth}/>;
  if (!booted) return <Boot onDone={()=>setBooted(true)}/>;

  const SW = isMobile ? 0 : collapsed ? 64 : 222;
  const titles = { dashboard:"Dashboard",produtos:"Winning Products",radar:"Trend Radar",ads:"Ads Spy",gap:"Market Gap Detector",calc:"Profit Calculator",download:"Creative Downloader",meta:"Meta Ads Intelligence",favoritos:"Favoritos",settings:"Configurações" };

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Sora,system-ui,sans-serif",display:"flex"}}>
      {/* Sidebar */}
      {(!isMobile||!collapsed)&&(
        <div style={{width:isMobile?240:SW,background:C.sidebar,display:"flex",flexDirection:"column",position:"fixed",top:0,bottom:0,left:0,zIndex:100,transition:"width 0.2s ease",overflow:"hidden",boxShadow:isMobile?"4px 0 20px rgba(0,0,0,0.3)":"none"}}>
          <div style={{padding:collapsed&&!isMobile?"20px 0":"20px 18px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",alignItems:"center",gap:10,justifyContent:collapsed&&!isMobile?"center":"flex-start"}}>
            <div style={{width:32,height:32,background:"linear-gradient(135deg,#1A56DB,#38BDF8)",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>⚡</div>
            {(!collapsed||isMobile)&&<div><div style={{fontSize:17,fontWeight:900,color:"#fff",letterSpacing:-0.5}}>NEXO</div><div style={{fontSize:9,color:"rgba(255,255,255,0.28)",letterSpacing:1,marginTop:-2}}>INTELLIGENCE v6.0</div></div>}
          </div>
          <nav style={{padding:"12px 8px",flex:1,overflowY:"auto"}}>
            {NAV.map(item=>(
              <button key={item.id} onClick={()=>{setNav(item.id);if(isMobile)setCollapsed(true);}} title={item.label} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:collapsed&&!isMobile?"9px 0":"9px 11px",borderRadius:9,background:nav===item.id?C.sidebarActive:"transparent",border:"none",color:nav===item.id?"#fff":"rgba(255,255,255,0.42)",fontWeight:nav===item.id?700:400,fontSize:12,cursor:"pointer",marginBottom:3,justifyContent:collapsed&&!isMobile?"center":"flex-start",transition:"all 0.15s",fontFamily:"Sora,system-ui,sans-serif"}} onMouseEnter={e=>{if(nav!==item.id)e.currentTarget.style.background="rgba(255,255,255,0.07)";}} onMouseLeave={e=>{if(nav!==item.id)e.currentTarget.style.background="transparent";}}>
                <span style={{fontSize:15,lineHeight:1,flexShrink:0}}>{item.icon}</span>
                {(!collapsed||isMobile)&&item.label}
                {item.id==="favoritos"&&favorites.length>0&&(!collapsed||isMobile)&&<span style={{marginLeft:"auto",background:"rgba(255,255,255,0.15)",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:700}}>{favorites.length}</span>}
              </button>
            ))}
          </nav>
          <div style={{padding:"12px 8px",borderTop:"1px solid rgba(255,255,255,0.06)"}}>
            {!isMobile&&(
              <button onClick={()=>setCollapsed(s=>!s)} style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:collapsed?"7px 0":"7px 11px",borderRadius:8,background:"transparent",border:"none",color:"rgba(255,255,255,0.28)",fontSize:12,cursor:"pointer",justifyContent:collapsed?"center":"flex-start",fontFamily:"Sora,system-ui,sans-serif"}}>
                <span style={{fontSize:14}}>{collapsed?"›":"‹"}</span>{!collapsed&&"Recolher"}
              </button>
            )}
            {(!collapsed||isMobile)&&(
              <button onClick={logout} style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 11px",borderRadius:8,background:"transparent",border:"none",color:"rgba(255,255,255,0.28)",fontSize:12,cursor:"pointer",fontFamily:"Sora,system-ui,sans-serif"}}>
                <span>🚪</span>Sair
              </button>
            )}
          </div>
        </div>
      )}
      {/* Mobile overlay */}
      {isMobile&&!collapsed&&<div onClick={()=>setCollapsed(true)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:99}}/>}
      {/* Main */}
      <div style={{marginLeft:isMobile?0:SW,flex:1,transition:"margin-left 0.2s ease",minWidth:0}}>
        {/* Topbar */}
        <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:50,gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {isMobile&&(
              <button onClick={()=>setCollapsed(false)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:16}}>☰</button>
            )}
            <div>
              <div style={{fontSize:17,fontWeight:800,color:C.text,letterSpacing:-0.5}}>{titles[nav]}</div>
              <div style={{fontSize:11,color:C.textLight,marginTop:1}}>Atualizado automaticamente</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
            <div style={{background:C.greenLight,color:C.green,border:"1px solid #BBF7D0",borderRadius:10,padding:"5px 12px",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",gap:5}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:C.green,display:"inline-block"}}/>Online
            </div>
            <button onClick={()=>setShowNotifs(o=>!o)} style={{background:unreadCount>0?C.blueLight:"none",border:`1px solid ${unreadCount>0?C.blue:C.border}`,borderRadius:10,padding:"6px 10px",cursor:"pointer",fontSize:16,position:"relative",color:C.text}}>
              🔔{unreadCount>0&&<span style={{position:"absolute",top:-4,right:-4,background:C.red,color:"#fff",borderRadius:"50%",width:16,height:16,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{unreadCount}</span>}
            </button>
            {!isMobile&&<ExportBtn/>}
          </div>
        </div>
        {/* Content */}
        <div style={{padding:isMobile?14:24}}>
          {nav==="dashboard"&&<Dashboard onNav={setNav}/>}
          {nav==="produtos"&&<WinningProducts onSelect={setModal} favorites={favorites} onToggleFav={toggleFav}/>}
          {nav==="radar"&&<TrendRadar/>}
          {nav==="ads"&&<AdsSpy/>}
          {nav==="gap"&&<MarketGap onSelect={setModal} favorites={favorites} onToggleFav={toggleFav}/>}
          {nav==="calc"&&<ProfitCalculator/>}
          {nav==="download"&&<CreativeDownloader/>}
          {nav==="meta"&&<MetaAds/>}
          {nav==="favoritos"&&<Favorites onSelect={setModal} favorites={favorites} onToggleFav={toggleFav}/>}
          {nav==="settings"&&<Settings user={user}/>}
        </div>
      </div>
      {/* Modals & Panels */}
      {modal&&<ProductModal p={modal} onClose={()=>setModal(null)} favorites={favorites} onToggleFav={toggleFav}/>}
      {showNotifs&&<NotificationsPanel onClose={()=>setShowNotifs(false)}/>}
      <style>{`
        @import url('${FONT_URL}');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes spin{to{transform:rotate(360deg);}}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:#0d1117;}
        ::-webkit-scrollbar-thumb{background:#30363d;border-radius:3px;}
        ::-webkit-scrollbar-thumb:hover{background:#484f58;}
        select,input,button,textarea{font-family:Sora,system-ui,sans-serif;}
        select option{background:#161b22;color:#e6edf3;}
        input[type=range]{-webkit-appearance:none;height:4px;border-radius:2px;background:#30363d;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#58a6ff;cursor:pointer;}
        input::placeholder{color:#484f58;}
        @media(max-width:640px){
          .modal-grid{grid-template-columns:1fr!important;}
        }
      `}</style>
    </div>
  );
}
