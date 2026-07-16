// GET /api/prospeccao/disparo/fila/:organizationId
// Visão em tempo real da fila de disparo — o que está previsto, processando e já enviado.
// Somente leitura, sem efeitos colaterais.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;

  const config = await prisma.disparoConfig.findUnique({ where: { organizationId } });
  const diasEntre = config?.diasEntreTentativas ?? 3;
  const maxTent = config?.maxTentativasContato ?? 3;
  const cutoff = new Date(Date.now() - diasEntre * 24 * 60 * 60 * 1000);

  const [jobsPorStatus, filaJobs, previstos, ultimosEnviados, totalEnviados] = await Promise.all([
    // Contagem da fila persistente por status
    prisma.disparoJob.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: true,
    }),

    // Jobs QUEUED/RUNNING agora — com o lead correspondente
    prisma.disparoJob.findMany({
      where: { organizationId, status: { in: ["QUEUED", "RUNNING"] } },
      orderBy: { criadoEm: "asc" },
      take: 50,
    }),

    // Leads elegíveis que AINDA não entraram na fila (previsão do próximo lote)
    prisma.prospectLead.findMany({
      where: {
        organizationId,
        NOT: { tipoTelefone: "FIXO" },
        OR: [
          { status: "APROVADO" },
          { status: "ABORDADO", dataAbordagem: { lte: cutoff }, tentativasDisparo: { lt: maxTent } },
          { status: "ERRO_ENVIO", tentativasDisparo: { lt: maxTent } },
        ],
      },
      orderBy: [{ tentativasDisparo: "asc" }, { score: "desc" }],
      take: 100,
      select: {
        id: true, nome: true, telefone: true, status: true,
        tentativasDisparo: true, score: true, sinalOportunidade: true,
      },
    }),

    // Últimos leads efetivamente abordados (disparos que aconteceram)
    prisma.prospectLead.findMany({
      where: { organizationId, dataAbordagem: { not: null } },
      orderBy: { dataAbordagem: "desc" },
      take: 30,
      select: {
        id: true, nome: true, telefone: true, status: true,
        tentativasDisparo: true, dataAbordagem: true, templateUsadoId: true,
      },
    }),

    prisma.prospectLead.count({ where: { organizationId, dataAbordagem: { not: null } } }),
  ]);

  // Enriquecer jobs QUEUED/RUNNING com dados do lead
  const leadIds = filaJobs.map((j) => j.leadId);
  const leadsDaFila = leadIds.length
    ? await prisma.prospectLead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, nome: true, telefone: true, status: true, tentativasDisparo: true },
      })
    : [];
  const leadMap = new Map(leadsDaFila.map((l) => [l.id, l]));

  const fila = filaJobs.map((j) => ({
    jobId: j.id,
    status: j.status,
    criadoEm: j.criadoEm,
    lead: leadMap.get(j.leadId) ?? { id: j.leadId, nome: "(lead removido)", telefone: null },
  }));

  const statusMap: Record<string, number> = {};
  for (const g of jobsPorStatus) statusMap[g.status] = g._count;

  const agora = new Date();
  const brt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false, weekday: "short",
  }).formatToParts(agora);
  const horaBRT = Number(brt.find((p) => p.type === "hour")?.value ?? 0);
  const inicio = config?.janelaInicioHora ?? 9;
  const fim = config?.janelaFimHora ?? 18;
  const dias = config?.diasSemana ?? [1, 2, 3, 4, 5];
  const dayMap: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sáb: 6 };
  const diaStr = (brt.find((p) => p.type === "weekday")?.value ?? "").toLowerCase().replace(".", "");
  const diaSemana = dayMap[diaStr] ?? agora.getDay();
  const dentroJanela = dias.includes(diaSemana) && horaBRT >= inicio && horaBRT < fim;

  return NextResponse.json({
    resumo: {
      naFila: (statusMap.QUEUED ?? 0) + (statusMap.RUNNING ?? 0),
      aguardando: statusMap.QUEUED ?? 0,
      processando: statusMap.RUNNING ?? 0,
      concluidos: statusMap.DONE ?? 0,
      falhas: statusMap.FAILED ?? 0,
      previstosProximoLote: previstos.length,
      totalJaEnviados: totalEnviados,
    },
    janela: {
      dentroJanela,
      horaAtualBRT: horaBRT,
      janela: `${inicio}h-${fim}h`,
      diasSemana: dias,
      limiteDiario: config?.limiteDiarioAtual ?? 15,
      pausado: config?.pausadoManualmente ?? false,
    },
    fila,               // jobs QUEUED/RUNNING agora
    previstos,          // próximos leads elegíveis (fila prevista)
    ultimosEnviados,    // histórico recente de disparos
  });
}
