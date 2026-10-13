// POST /api/meta/capi/reenviar — reenvia à Meta os eventos que falharam
// (FAILED) ou foram registrados sem configuração (SKIPPED_NO_CONFIG), só os
// criados há menos de 6 dias (a Meta não aceita evento muito antigo).
// GET — contagem de eventos por status.
//
// Auth: sessão ADMIN do CRM, ou x-cron-secret (agendador externo).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";
import { chamadaInterna } from "@/lib/prospeccao/guard";
import { enviarEventoMeta } from "@/lib/meta-capi";
import type { EventoMeta } from "@/lib/crm/funil-config";

export const maxDuration = 60;

const JANELA_DIAS = 6;
const LOTE = 25;

async function autorizado(req: NextRequest): Promise<boolean> {
  if (chamadaInterna(req)) return true;
  try {
    await requireAdmin();
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000);
  const pendentes = await prisma.metaConversionEvent.findMany({
    where: {
      createdAt: { gte: desde },
      OR: [
        { status: { in: ["FAILED", "SKIPPED_NO_CONFIG"] } },
        // PENDING parado (função morreu no meio do envio)
        { status: "PENDING", atualizadoEm: { lt: new Date(Date.now() - 10 * 60_000) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: LOTE,
    select: { leadId: true, eventName: true },
  });

  const resumo: Record<string, number> = {};
  const inicio = Date.now();
  for (const ev of pendentes) {
    if (Date.now() - inicio > 45_000) break; // sobra para a próxima chamada
    const r = await enviarEventoMeta(ev.leadId, ev.eventName as EventoMeta, { reenviar: true });
    resumo[r.resultado] = (resumo[r.resultado] ?? 0) + 1;
  }
  return NextResponse.json({ ok: true, candidatos: pendentes.length, resumo });
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const grupos = await prisma.metaConversionEvent.groupBy({ by: ["status", "eventName"], _count: true });
  return NextResponse.json({ eventos: grupos.map((g) => ({ status: g.status, evento: g.eventName, quantidade: g._count })) });
}
