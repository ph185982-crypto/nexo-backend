// POST /api/prospeccao/empresas/acoes — ação em massa
// body: { ids: string[], acao: "aprovar" | "descartar" | "revisar" | "reprocessar" | "perdido" }
// Só atualiza as empresas cujo status atual permite a ação; devolve quantas mudaram.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { exigirAcesso } from "@/lib/prospeccao/guard";
import { ACOES_MANUAIS, isAcaoManual } from "@/lib/prospeccao/status";
import { dadosDaAcao } from "@/lib/prospeccao/acoes";

export async function POST(req: NextRequest) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;

  const body = await req.json().catch(() => ({})) as { ids?: unknown; acao?: string };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 1000) : [];
  if (ids.length === 0) return NextResponse.json({ error: "Informe ao menos uma empresa" }, { status: 400 });
  if (!body.acao || !isAcaoManual(body.acao)) {
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  }

  const regra = ACOES_MANUAIS[body.acao];
  const r = await prisma.prospectLead.updateMany({
    where: { id: { in: ids }, status: { in: [...regra.de] } },
    data: dadosDaAcao(body.acao),
  });

  return NextResponse.json({ ok: true, alterados: r.count, ignorados: ids.length - r.count });
}
