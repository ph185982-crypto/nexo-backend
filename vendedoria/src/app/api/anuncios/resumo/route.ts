// GET /api/anuncios/resumo?de=YYYY-MM-DD&ate=YYYY-MM-DD
// Resultado por anúncio (adSourceId): leads, qualificados, ganhos e valor ganho.
// Leads = quem chegou por anúncio no período (adReferralAt). Qualificados e
// ganhos vêm da coluna atual do lead no Kanban (mapeamento em funil-config.ts).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";
import { agregarPorAnuncio } from "@/lib/anuncios";

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

function parseDia(s: string | null, fimDoDia = false): Date | null {
  if (!s || !RE_DATA.test(s)) return null;
  const d = new Date(`${s}T${fimDoDia ? "23:59:59.999" : "00:00:00.000"}-03:00`); // Brasília
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const q = new URL(req.url).searchParams;
  const ate = parseDia(q.get("ate"), true) ?? new Date();
  const de = parseDia(q.get("de")) ?? new Date(ate.getTime() - 30 * 86_400_000);

  const leads = await prisma.lead.findMany({
    where: {
      OR: [{ adSourceId: { not: null } }, { ctwaClid: { not: null } }],
      adReferralAt: { gte: de, lte: ate },
    },
    select: {
      adSourceId: true, adHeadline: true, valorContrato: true, adReferralAt: true,
      kanbanColumn: { select: { type: true, name: true } },
    },
    orderBy: { adReferralAt: "desc" },
    take: 10_000,
  });

  const { anuncios, total } = agregarPorAnuncio(leads);

  return NextResponse.json({ de: de.toISOString(), ate: ate.toISOString(), anuncios, total });
}
