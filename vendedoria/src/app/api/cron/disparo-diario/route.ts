import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { executarDisparoDiario, incrementarWarmupSemanal, getHoraBRT } from "@/lib/prospeccao/disparo";

export const maxDuration = 1800;

// GET /api/cron/disparo-diario
// Chamado 1x/dia via cron externo. Protegido por CRON_SECRET.
// Executa disparo para todas as orgs de prospecção ativas.
// Na sexta-feira (dia 5) também incrementa o warm-up semanal.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.CRON_SECRET || (auth !== `Bearer ${process.env.CRON_SECRET}` && secret !== process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgsProspeccao = await prisma.whatsappBusinessOrganization.findMany({
    where: { tipo: "PROSPECCAO", status: "ACTIVE" },
    select: { id: true },
  });

  const resultados: Record<string, unknown> = {};
  const { diaSemana } = getHoraBRT();
  const ehSexta = diaSemana === 5;

  for (const org of orgsProspeccao) {
    const resultado = await executarDisparoDiario(org.id);
    resultados[org.id] = resultado;

    if (ehSexta) {
      await incrementarWarmupSemanal(org.id);
      (resultados[org.id] as Record<string, unknown>).warmupIncrementado = true;
    }
  }

  return NextResponse.json({ ok: true, orgsProcessadas: orgsProspeccao.length, resultados });
}
