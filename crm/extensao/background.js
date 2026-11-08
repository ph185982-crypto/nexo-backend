// Envia a conversa ao CRM. Fica no service worker: a chave não passa pela página do WhatsApp.
const PADRAO = "https://nexo-crm-tawny.vercel.app";

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  if (!msg || msg.tipo !== "enviar") return false;
  (async () => {
    const { crmUrl, chave } = await chrome.storage.sync.get(["crmUrl", "chave"]);
    if (!chave) return responder({ ok: false, erro: "Configure a chave da extensão: clique no ícone da Avanteza na barra do Chrome." });
    const base = String(crmUrl || PADRAO).replace(/\/+$/, "");
    try {
      const r = await fetch(`${base}/api/integracoes/whatsapp/mensagens`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${chave}` },
        body: JSON.stringify(msg.dados),
      });
      const corpo = await r.json().catch(() => ({}));
      if (r.status === 401) return responder({ ok: false, erro: "Chave recusada pelo CRM. Crie outra em Configuração → Chaves e salve na extensão." });
      if (!r.ok) return responder({ ok: false, erro: corpo.erro || `O CRM respondeu ${r.status}.` });
      responder({ ok: true, dados: corpo });
    } catch (e) {
      responder({ ok: false, erro: `Sem conexão com o CRM (${base}).` });
    }
  })();
  return true; // resposta assíncrona
});
