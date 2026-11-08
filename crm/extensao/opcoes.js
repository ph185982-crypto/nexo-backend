const PADRAO = "https://nexo-crm-tawny.vercel.app";
const $ = (id) => document.getElementById(id);
chrome.storage.sync.get(["crmUrl", "chave"]).then(({ crmUrl, chave }) => {
  $("url").value = crmUrl || PADRAO;
  if (chave) $("chave").placeholder = "já configurada (cole outra para trocar)";
  $("chave").required = !chave;
});
$("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("url").value.trim().replace(/\/+$/, "");
  const chave = $("chave").value.trim();
  if (!/^https:\/\//.test(url)) { $("msg").textContent = "Use um endereço https://"; return; }
  if (chave && !/^avz_live_[a-f0-9]{48}$/.test(chave)) { $("msg").textContent = "A chave começa com avz_live_ (crie em Configuração → Chaves no CRM)."; return; }
  // Endereço diferente do padrão: o Chrome pede permissão para a extensão falar com ele.
  if (url !== PADRAO) {
    const ok = await chrome.permissions.request({ origins: [`${url}/*`] });
    if (!ok) { $("msg").textContent = "Sem permissão para esse endereço."; return; }
  }
  await chrome.storage.sync.set({ crmUrl: url, ...(chave ? { chave } : {}) });
  $("chave").value = "";
  $("msg").textContent = "Salvo. Recarregue a aba do WhatsApp Web.";
});
