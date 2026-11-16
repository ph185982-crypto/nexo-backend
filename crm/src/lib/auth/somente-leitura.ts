// Congelamento do CRM antigo para o corte (F5/C13, roteiro em vendedoria/docs/CORTE_CRM.md).
// CRM_SOMENTE_LEITURA=1 no projeto nexo-crm: qualquer método diferente de GET responde 423 (Locked), exceto /api/health.
// Telas e leituras continuam; login por senha, edições, eventos do Vendedor IA (que ficam PENDENTES na outbox de lá
// e são reaplicados no Comercial nativo) e a API de serviço da Central param de gravar. Edge-safe (sem Node).
export const somenteLeitura = (env: Record<string, string | undefined> = process.env) => env.CRM_SOMENTE_LEITURA?.trim() === "1";

/** Resposta 423 quando a requisição tentaria gravar com o CRM congelado; null quando pode seguir. */
export function bloqueioSomenteLeitura(metodo: string, pathname: string, env: Record<string, string | undefined> = process.env): Response | null {
  if (!somenteLeitura(env) || metodo.toUpperCase() === "GET" || pathname === "/api/health") return null;
  return Response.json(
    { erro: "CRM em modo somente leitura: o Comercial agora fica em app.avanteza.com.br/comercial" },
    { status: 423, headers: { "Cache-Control": "no-store" } },
  );
}
