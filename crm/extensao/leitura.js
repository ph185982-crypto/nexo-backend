// Leitura da conversa aberta no WhatsApp Web. Funções puras sobre o DOM (testáveis fora do Chrome).
// O WhatsApp Web muda o HTML de tempos em tempos; o que esta leitura usa é o mais estável:
//  - cada mensagem fica num elemento com data-id = "true_<chat>_<id>" (enviada por mim) ou "false_<chat>_<id>";
//  - o texto copiável tem data-pre-plain-text = "[14:35, 20/11/2026] Nome: ".
(function (raiz) {
  "use strict";

  /** "[14:35, 20/11/2026] Pedro Martins: " → { em: Date ISO, autor }. Aceita "2:35 PM" e ano com 2 dígitos. */
  function lerCabecalho(pre) {
    const m = /^\[(\d{1,2}):(\d{2})(?:\s?([AaPp])\.?\s?[Mm]\.?)?,\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]\s*(.*?):\s*$/.exec(String(pre || "").trim() + " ");
    if (!m) return null;
    let hora = Number(m[1]);
    if (m[3]) { const pm = m[3].toLowerCase() === "p"; if (pm && hora < 12) hora += 12; if (!pm && hora === 12) hora = 0; }
    let ano = Number(m[6]); if (ano < 100) ano += 2000;
    const dia = Number(m[4]), mes = Number(m[5]);
    if (mes > 12 || dia > 31) return null;
    const iso = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}T${String(hora).padStart(2, "0")}:${m[2]}:00-03:00`;
    const em = new Date(iso);
    if (Number.isNaN(em.getTime())) return null;
    return { em: em.toISOString(), autor: m[7].trim() };
  }

  /** data-id → { deMim, chat }. "true_5562999999999@c.us_3EB0…" → { deMim: true, chat: "5562999999999@c.us" }. */
  function lerDataId(dataId) {
    const m = /^(true|false)_([^_]+@[a-z.]+)_/.exec(String(dataId || ""));
    return m ? { deMim: m[1] === "true", chat: m[2] } : null;
  }

  /** Telefone do chat (só dígitos) quando o identificador traz o número; grupo e @lid não trazem. */
  function telefoneDoChat(chat) {
    const m = /^(\d{10,15})@(c\.us|s\.whatsapp\.net)$/.exec(String(chat || ""));
    return m ? m[1] : null;
  }

  /** Telefone escrito no título da conversa (contato não salvo aparece como "+55 62 99999-9999"). */
  function telefoneDoTitulo(titulo) {
    const d = String(titulo || "").replace(/[^\d+]/g, "");
    return /^\+?\d{10,15}$/.test(d) ? d.replace("+", "") : null;
  }

  /** Coleta as mensagens de texto carregadas na conversa aberta. */
  function coletarConversa(doc) {
    const principal = doc.querySelector("#main") || doc;
    const titulo = (principal.querySelector("header [title]") || principal.querySelector("header span[dir='auto']") || {}).textContent || "";
    const mensagens = [];
    let chat = null;
    const vistos = new Set();
    for (const el of principal.querySelectorAll("[data-id]")) {
      const id = lerDataId(el.getAttribute("data-id"));
      if (!id) continue;
      chat = chat || id.chat;
      const copiavel = el.querySelector("[data-pre-plain-text]");
      if (!copiavel) continue; // áudio, imagem sem legenda, aviso do sistema
      const cab = lerCabecalho(copiavel.getAttribute("data-pre-plain-text"));
      if (!cab) continue;
      const textoEl = copiavel.querySelector(".selectable-text") || copiavel;
      const texto = (textoEl.innerText || textoEl.textContent || "").trim();
      if (!texto) continue;
      const chave = el.getAttribute("data-id");
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      mensagens.push({ autor: id.deMim ? "Eu" : cab.autor, deMim: id.deMim, texto, em: cab.em });
    }
    const grupo = Boolean(chat && /@g\.us$/.test(chat));
    return { nome: titulo.trim() || null, telefone: telefoneDoChat(chat) || telefoneDoTitulo(titulo), grupo, mensagens };
  }

  const api = { lerCabecalho, lerDataId, telefoneDoChat, telefoneDoTitulo, coletarConversa };
  raiz.AvantezaLeitura = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
