// Botão "Enviar ao CRM" no WhatsApp Web. Lê só a conversa aberta, só quando a pessoa clica.
(function () {
  "use strict";
  const L = globalThis.AvantezaLeitura;
  const AZUL = "#2448FF", BQ = "#F6F5F0", GRAFITE = "#18191D", LARANJA = "#FF7043";

  function aviso(texto, tipo) {
    let el = document.getElementById("avanteza-aviso");
    if (!el) {
      el = document.createElement("div");
      el.id = "avanteza-aviso";
      el.setAttribute("role", "status");
      Object.assign(el.style, { position: "fixed", right: "16px", bottom: "72px", zIndex: 99999, maxWidth: "340px", padding: "10px 14px", borderRadius: "10px", font: "13px/1.4 Inter, Arial, sans-serif", boxShadow: "0 6px 20px rgba(0,0,0,.2)" });
      document.body.appendChild(el);
    }
    el.style.background = tipo === "erro" ? LARANJA : GRAFITE;
    el.style.color = tipo === "erro" ? GRAFITE : BQ;
    el.textContent = texto;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.remove(), 9000);
  }

  async function enviar(botao) {
    const conversa = L.coletarConversa(document);
    if (conversa.grupo) return aviso("Conversas em grupo não são enviadas. Abra a conversa individual do cliente.", "erro");
    if (!conversa.mensagens.length) return aviso("Abra a conversa do cliente (e role para cima para carregar o que quiser enviar).", "erro");
    if (!conversa.telefone) {
      const digitado = prompt("Não consegui ler o telefone deste contato. Digite o número com DDD (ex.: 62 99999-9999):");
      if (!digitado) return;
      conversa.telefone = digitado.replace(/\D/g, "");
    }
    botao.disabled = true;
    botao.textContent = "Enviando…";
    try {
      const r = await chrome.runtime.sendMessage({ tipo: "enviar", dados: { telefone: conversa.telefone, nome: conversa.nome, mensagens: conversa.mensagens } });
      if (!r || !r.ok) aviso(r && r.erro ? r.erro : "Não foi possível enviar.", "erro");
      else {
        const d = r.dados;
        const onde = d.oportunidade ? `na ficha "${d.oportunidade.nome}"` : `no contato ${d.contato.nome} (sem oportunidade aberta)`;
        aviso(d.novas === 0 ? `Nada novo: essas ${d.recebidas} mensagens já estavam no CRM.` : `${d.novas} mensagem(ns) nova(s) ${onde}.${d.analiseId ? " O agente vai sugerir os combinados." : ""}`);
      }
    } catch (e) {
      aviso("A extensão foi atualizada: recarregue a página do WhatsApp.", "erro");
    } finally {
      botao.disabled = false;
      botao.textContent = "Enviar ao CRM";
    }
  }

  function criarBotao() {
    if (document.getElementById("avanteza-enviar")) return;
    const b = document.createElement("button");
    b.id = "avanteza-enviar";
    b.type = "button";
    b.textContent = "Enviar ao CRM";
    b.title = "Envia as mensagens carregadas desta conversa para a ficha do cliente no CRM Avanteza";
    Object.assign(b.style, { position: "fixed", right: "16px", bottom: "20px", zIndex: 99999, background: AZUL, color: BQ, border: "0", borderRadius: "10px", padding: "10px 16px", font: "700 13px Inter, Arial, sans-serif", cursor: "pointer", boxShadow: "0 6px 20px rgba(0,0,0,.2)" });
    b.addEventListener("click", () => enviar(b));
    document.body.appendChild(b);
  }

  criarBotao();
  // O WhatsApp Web reconstrói a página: garante o botão de tempos em tempos.
  setInterval(criarBotao, 3000);
})();
