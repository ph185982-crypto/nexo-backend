// Regras de acesso das rotas /api/*, avaliadas no middleware (Edge, sem banco).
//
// Até 30/10 só /crm/* era protegido: /api/followups devolvia telefones de
// leads para qualquer um, /api/agent/prompt/restore trocava o prompt da IA
// sem login, /api/integrations/google/status (DELETE) desconectava o Google.
// Agora a regra é "fechado por padrão": só passa quem está logado, quem traz
// uma credencial que a própria rota valida (chave de API, segredo do cron,
// assinatura da Meta) ou o que está na lista pública abaixo.

/** Prefixos públicos por desenho — cada rota aqui ou é pública mesmo ou se protege sozinha. */
export const PREFIXOS_PUBLICOS = [
  "/api/auth/",                 // NextAuth (login, sessão, csrf)
  "/api/health",                // monitoramento externo
  "/api/keepalive",
  "/api/max/health",
  "/api/webhooks/",             // Meta: GET de verificação sem assinatura; POST assinado (a rota valida)
  "/api/pagamentos/webhook",    // Mercado Pago (a rota valida a assinatura)
  "/api/cron/",                 // exige CRON_SECRET dentro da rota
  "/api/oauth/",                // descoberta OAuth do MCP precisa ser anônima
  "/api/mcp",                   // mcp-handler devolve o 401 com WWW-Authenticate que o fluxo OAuth exige
  "/api/checkout/",             // página pública de pagamento do cliente
  "/api/cep/",                  // consulta de CEP usada no checkout
  "/api/push/vapid-public-key", // chave pública do push (não é segredo)
  "/api/media/",                // imagens de produto da página pública
  "/api/integrations/google/callback", // redirect do Google após autorizar
  "/api/debug/",                // exigem ?secret=CRON_SECRET dentro da rota
  "/api/admin/setup",           // só funciona com banco vazio ou com o segredo
  "/api/admin/reset-admin",     // exige segredo
  "/api/admin/migrate-from-render",
  "/api/admin/deescalate-all",
] as const;

export function rotaPublica(pathname: string): boolean {
  return PREFIXOS_PUBLICOS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

/** Headers que indicam uma credencial que a rota vai validar por conta própria. */
const HEADERS_DE_CREDENCIAL = ["authorization", "x-api-key", "x-cron-secret", "x-hub-signature-256"] as const;

export type DecisaoAcesso = "permitir" | "negar";

/** Decide o acesso a uma rota /api/* sem tocar no banco. */
export function decidirAcessoApi(
  pathname: string,
  logado: boolean,
  headers: { get(nome: string): string | null },
): DecisaoAcesso {
  if (rotaPublica(pathname)) return "permitir";
  if (logado) return "permitir";
  if (HEADERS_DE_CREDENCIAL.some((h) => Boolean(headers.get(h)?.trim()))) return "permitir";
  return "negar";
}
