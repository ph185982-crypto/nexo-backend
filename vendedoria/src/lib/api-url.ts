// Endereço das rotas da API para o código que roda no navegador. ÚNICO lugar com o prefixo "/api":
// tests/api-url.test.ts falha se aparecer fetch("/api…") fora daqui.
//
// O Comercial vai morar também sob a Central (app.avanteza.com.br/comercial/*, por reescrita): lá, "/api/…"
// é a API da Central. Por isso, numa página aberta sob /comercial, a chamada vai para /comercial/api/…
// (o Vendedor IA atende esse alias com as mesmas regras de acesso de /api/*). No resto, "/api/…" como sempre.

const PREFIXO_COMERCIAL = "/comercial";

/** Prefixo de rota da página atual que precisa ir junto nas chamadas da API ("" ou "/comercial"). */
export function prefixoDaPagina(pathname?: string): string {
  const caminho = pathname ?? (typeof window !== "undefined" ? window.location.pathname : "");
  return caminho === PREFIXO_COMERCIAL || caminho.startsWith(`${PREFIXO_COMERCIAL}/`) ? PREFIXO_COMERCIAL : "";
}

/**
 * Monta o endereço de uma rota da API. Aceita "/api/x" ou "api/x" (o "/api" é acrescentado se faltar).
 * Ex.: apiUrl("/api/comercial/quadro?funil=1") → "/comercial/api/comercial/quadro?funil=1" numa página do Comercial.
 */
export function apiUrl(caminho: string, pathname?: string): string {
  const limpo = caminho.startsWith("/") ? caminho : `/${caminho}`;
  const comApi = limpo === "/api" || limpo.startsWith("/api/") ? limpo : `/api${limpo}`;
  return `${prefixoDaPagina(pathname)}${comApi}`;
}
