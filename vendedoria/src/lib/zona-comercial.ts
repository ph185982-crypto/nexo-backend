// Endereço único do Comercial: app.avanteza.com.br/comercial/* serve o Vendedor IA por reescrita na Central (sem basePath:
// o webhook da Meta em /api/webhooks/whatsapp e o da ClickSign continuam no domínio antigo, intactos).
//
// Este arquivo é a fonte única dos caminhos da "zona": next.config.ts lê ALIASES_LEGADOS e ARQUIVOS_PUBLICOS daqui,
// e os componentes de navegação usam hrefNaZona para manter a pessoa sob /comercial quando ela já está lá.
// Sem dependências (é importado pelo next.config.ts, pelo middleware e por componentes de cliente).

export const ZONA = "/comercial";

/**
 * Telas antigas do Vendedor IA com endereço amigável sob /comercial. O domínio antigo continua abrindo /crm/*.
 * Ordem importa: o primeiro prefixo que casar vence (os mais específicos primeiro).
 */
export const ALIASES_LEGADOS: ReadonlyArray<{ zona: string; legado: string }> = [
  { zona: "/comercial/conversas", legado: "/crm/conversations" },
  { zona: "/comercial/leads", legado: "/crm/lead/kanban" },
  { zona: "/comercial/ligacoes", legado: "/crm/ligacoes" },
  { zona: "/comercial/prospeccao", legado: "/crm/prospeccao" },
  { zona: "/comercial/disparos", legado: "/crm/disparos" },
  { zona: "/comercial/calendario", legado: "/crm/calendar" },
  { zona: "/comercial/agente", legado: "/crm/configure-agent" },
  { zona: "/comercial/configuracoes", legado: "/crm/settings" },
];

/** Qualquer outra tela antigo: /comercial/crm/<resto> abre /crm/<resto>. */
export const PREFIXO_LEGADO_GENERICO = "/comercial/crm";

/** Arquivos de public/ que também respondem sob /comercial (ícones, manifesto e fontes do PDF do contrato). */
export const ARQUIVOS_PUBLICOS = ["/fonts", "/icon-192.png", "/icon-512.png", "/manifest.json", "/offline.html"] as const;

export const naZona = (pathname: string) => pathname === ZONA || pathname.startsWith(`${ZONA}/`);

const casa = (caminho: string, prefixo: string) => caminho === prefixo || caminho.startsWith(`${prefixo}/`) || caminho.startsWith(`${prefixo}?`);

/** Caminho com prefixo de arquivo estático da zona (funciona nos dois domínios: o Vendedor IA reescreve /comercial/<arquivo>). */
export const ativo = (caminho: string) => `${ZONA}${caminho.startsWith("/") ? caminho : `/${caminho}`}`;

/**
 * Endereço de um link interno para a página atual. Fora da zona: o próprio href. Na zona (app.avanteza.com.br/comercial):
 * /crm/conversations → /comercial/conversas, demais /crm/x → /comercial/crm/x; /comercial/* e externos não mudam.
 */
export function hrefNaZona(href: string, pathnameAtual?: string): string {
  const atual = pathnameAtual ?? (typeof window !== "undefined" ? window.location.pathname : "");
  if (!naZona(atual) || !href.startsWith("/") || href.startsWith("//")) return href;
  if (href === "/crm" || href.startsWith("/crm?")) return `${ZONA}${href.slice("/crm".length)}`;
  for (const a of ALIASES_LEGADOS) if (casa(href, a.legado)) return a.zona + href.slice(a.legado.length);
  if (casa(href, "/crm")) return PREFIXO_LEGADO_GENERICO + href.slice("/crm".length);
  return href;
}

/** Caminho real (dentro do Vendedor IA) de um endereço da zona — o inverso de hrefNaZona, usado nas reescritas e nos testes. */
export function caminhoReal(pathname: string): string {
  for (const a of ALIASES_LEGADOS) if (casa(pathname, a.zona)) return a.legado + pathname.slice(a.zona.length);
  if (casa(pathname, PREFIXO_LEGADO_GENERICO)) return "/crm" + pathname.slice(PREFIXO_LEGADO_GENERICO.length);
  return pathname;
}

/**
 * Link público da proposta. No servidor, a origem da requisição é a do Vendedor IA (a reescrita da Central não muda o
 * host aqui dentro): COMERCIAL_URL_PUBLICA (ex.: https://app.avanteza.com.br/comercial) dá o endereço que o cliente vê.
 */
export function linkPublicoProposta(token: string, origemDaRequisicao: string, env: Record<string, string | undefined> = process.env): string {
  const base = (env.COMERCIAL_URL_PUBLICA?.trim() || `${origemDaRequisicao}${ZONA}`).replace(/\/+$/, "");
  return `${base}/p/${token}`;
}
