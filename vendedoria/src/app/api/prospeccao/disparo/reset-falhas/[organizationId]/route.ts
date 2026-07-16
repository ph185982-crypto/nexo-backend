// POST /api/prospeccao/disparo/reset-falhas/:organizationId
// Recupera leads que foram para ERRO_ENVIO/DESCARTADO por causa de falha de
// ENVIO (não por decisão de qualificação) — reseta para APROVADO e zera as
// tentativas, para poderem ser disparados de novo depois de corrigir o template.
// Também limpa os DisparoJob FAILED/DONE dessa org. Exige sessão ADMIN.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = await params;

  // Só recupera leads cuja falha foi de ENVIO (motivo começa com "Falha no envio")
  const resetLeads = await prisma.prospectLead.updateMany({
    where: {
      organizationId,
      status: { in: ["ERRO_ENVIO", "DESCARTADO"] },
      motivoAnaliseIA: { startsWith: "Falha no envio" },
    },
    data: {
      status: "APROVADO",
      tentativasDisparo: 0,
      dataAbordagem: null,
      motivoAnaliseIA: null,
    },
  });

  // Limpa a fila persistente (jobs concluídos/falhos) dessa org
  const limpezaJobs = await prisma.disparoJob.deleteMany({
    where: { organizationId, status: { in: ["FAILED", "DONE"] } },
  });

  return NextResponse.json({
    ok: true,
    leadsRecuperados: resetLeads.count,
    jobsLimpos: limpezaJobs.count,
  });
}
