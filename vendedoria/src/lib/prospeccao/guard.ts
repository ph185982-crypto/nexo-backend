// Guarda das rotas /api/prospeccao/*. O middleware só protege /crm, então
// cada rota precisa checar a sessão. Chamadas internas encadeadas (enfileirar)
// não têm sessão e se identificam pelo header x-cron-secret.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export function chamadaInterna(req: NextRequest): boolean {
  const segredo = process.env.CRON_SECRET;
  return Boolean(segredo) && req.headers.get("x-cron-secret") === segredo;
}

/** Devolve uma resposta 401 quando não autorizado; null quando pode seguir. */
export async function exigirAcesso(req: NextRequest): Promise<NextResponse | null> {
  if (chamadaInterna(req)) return null;
  const session = await auth();
  if (session?.user) return null;
  return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
}
