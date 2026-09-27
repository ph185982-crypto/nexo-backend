// Pipeline de qualificação: leva cada empresa de NOVO até a decisão da IA
// (APROVADO / ANALISADO / DESCARTADO) numa passada só — enriquecer → pontuar →
// analisar. Roda dentro de um orçamento de tempo e devolve quanto falta, para
// o cliente chamar de novo até zerar (cada invocação serverless é curta).

import { prisma } from "@/lib/prisma/client";
import { enriquecerLead } from "./enriquecimento";
import { calcularScore } from "./score";
import { analisarLead } from "./agente-analista";

export interface RestantesPipeline {
  novo: number;
  enriquecido: number;
  pontuado: number;
  total: number;
}

export interface ResultadoPipeline {
  processados: number;
  erros: number;
  aprovados: number;
  revisao: number;
  descartados: number;
  restantes: RestantesPipeline;
}

export async function contarPendentes(segmentId: string): Promise<RestantesPipeline> {
  const grupos = await prisma.prospectLead.groupBy({
    by: ["status"],
    where: { segmentId, status: { in: ["NOVO", "ENRIQUECIDO", "PONTUADO"] } },
    _count: { _all: true },
  });
  const c = (s: string) => grupos.find((g) => g.status === s)?._count._all ?? 0;
  const novo = c("NOVO");
  const enriquecido = c("ENRIQUECIDO");
  const pontuado = c("PONTUADO");
  return { novo, enriquecido, pontuado, total: novo + enriquecido + pontuado };
}

/** Avança um lead pelas etapas que faltam. Devolve o status final. */
async function avancarLead(leadId: string, status: string): Promise<string> {
  if (status === "NOVO") {
    await enriquecerLead(leadId);
    status = "ENRIQUECIDO";
  }
  if (status === "ENRIQUECIDO") {
    await calcularScore(leadId);
    status = "PONTUADO";
  }
  if (status === "PONTUADO") {
    await analisarLead(leadId);
  }
  const final = await prisma.prospectLead.findUnique({ where: { id: leadId }, select: { status: true } });
  return final?.status ?? status;
}

export async function processarPipeline(segmentId: string, orcamentoMs: number): Promise<ResultadoPipeline> {
  const inicio = Date.now();
  const r: Omit<ResultadoPipeline, "restantes"> = { processados: 0, erros: 0, aprovados: 0, revisao: 0, descartados: 0 };
  // Um lead que falhou não volta na mesma passada (evita laço sobre o mesmo erro).
  const falharam = new Set<string>();

  while (Date.now() - inicio < orcamentoMs) {
    const lote = await prisma.prospectLead.findMany({
      where: {
        segmentId,
        status: { in: ["PONTUADO", "ENRIQUECIDO", "NOVO"] },
        ...(falharam.size ? { id: { notIn: [...falharam] } } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true },
      take: 10,
    });
    if (lote.length === 0) break;

    for (const lead of lote) {
      if (Date.now() - inicio >= orcamentoMs) break;
      try {
        const final = await avancarLead(lead.id, lead.status);
        r.processados++;
        if (final === "APROVADO") r.aprovados++;
        else if (final === "ANALISADO") r.revisao++;
        else if (final === "DESCARTADO") r.descartados++;
      } catch (e) {
        console.error(`[Pipeline] Erro no lead ${lead.id}:`, e);
        falharam.add(lead.id);
        r.erros++;
      }
      // Respiro entre chamadas externas (Meta Ad Library / Instagram / LLM)
      await new Promise((res) => setTimeout(res, 300));
    }
  }

  return { ...r, restantes: await contarPendentes(segmentId) };
}
