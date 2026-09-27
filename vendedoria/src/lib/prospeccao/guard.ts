// Guarda das rotas /api/prospeccao/*. O middleware só protege /crm, então
// cada rota precisa checar a sessão. Três formas de passar:
//   1. Sessão de navegador (usuário logado no CRM)
//   2. Chave de API (Authorization: Bearer nexo_live_... ou x-api-key) — para
//      integrações externas, o MCP server, outros agentes
//   3. x-cron-secret — só para as chamadas internas encadeadas (enfileirar)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { validarChaveApi } from "@/lib/auth/api-key";

export function chamadaInterna(req: NextRequest): boolean {
  const segredo = process.env.CRON_SECRET;
  return Boolean(segredo) && req.headers.get("x-cron-secret") === segredo;
}

/** Devolve uma resposta 401 quando não autorizado; null quando pode seguir. */
export async function exigirAcesso(req: NextRequest): Promise<NextResponse | null> {
  if (chamadaInterna(req)) return null;
  if (await validarChaveApi(req)) return null;
  const session = await auth();
  if (session?.user) return null;
  return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
}
