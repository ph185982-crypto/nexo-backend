import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { executarDisparoDiario, incrementarWarmupSemanal } from "@/lib/prospeccao/disparo";

// GET /api/cron/disparo-diario
// Chamado 1x/dia via cron externo (mesmo padrão do /api/cron/followup).
// Executa disparo para todas as orgs de prospecção ativas.
// Na sexta-feira (dia 5) também incrementa o warm-up semanal.
export async function GET() {
  const orgsProspeccao = await prisma.whatsappBusinessOrganization.findMany({
    where: { tipo: "PROSPECCAO", status: "ACTIVE" },
    select: { id: true },
  });

  const resultados: Record<string, unknown> = {};
  const hoje = new Date();
  const ehSexta = hoje.getDay() === 5;

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
