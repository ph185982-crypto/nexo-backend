// Correção de dados do Kanban (30/10): 46 leads escalados continuavam em
// "Novos" e os 1.000 leads de prospecção caíram em "Novos" em vez de "1º
// Contato" — o quadro virou depósito. Aqui só se MOVE card entre colunas, com
// registro em LeadActivity; nada é apagado. Idempotente: rodar duas vezes não
// muda nada na segunda.
import { prisma } from "@/lib/prisma/client";
import { canonicalizarTipo } from "./pipeline-mover";

export type EscopoSincronizacao = "escalados" | "outbound";

interface Alvo { tipoAlvo: string; nomeAlvo: string; descricao: string; whereLead: Record<string, unknown> }

// Tipo cru primeiro: o canônico de CONTATO_1 é TRIAGE ("Novos"), justamente a origem.
async function colunaPorTipo(organizationId: string, tipo: string) {
  return (
    await prisma.kanbanColumn.findFirst({ where: { organizationId, type: tipo } }) ??
    await prisma.kanbanColumn.findFirst({ where: { organizationId, type: canonicalizarTipo(tipo) } })
  );
}

async function montarAlvo(organizationId: string, escopo: EscopoSincronizacao): Promise<Alvo | { erro: string }> {
  const novos = await prisma.kanbanColumn.findMany({ where: { organizationId, type: "TRIAGE" }, select: { id: true } });
  const idsNovos = novos.map((c) => c.id);
  if (escopo === "escalados") {
    const col = await colunaPorTipo(organizationId, "ESCALATED");
    if (!col) return { erro: "Não existe coluna de handoff (tipo ESCALATED) nesta organização" };
    return {
      tipoAlvo: "ESCALATED", nomeAlvo: col.name,
      descricao: "Leads escalados para o especialista que ainda estão em \"Novos\"",
      whereLead: { organizationId, status: "ESCALATED", kanbanColumnId: { in: idsNovos } },
    };
  }
  const col = await colunaPorTipo(organizationId, "CONTATO_1");
  if (!col) return { erro: "Não existe coluna \"1º Contato\" (tipo CONTATO_1) nesta organização" };
  return {
    tipoAlvo: "CONTATO_1", nomeAlvo: col.name,
    descricao: "Leads de prospecção (saída) que estão em \"Novos\"",
    whereLead: { organizationId, leadOrigin: "OUTBOUND", status: { not: "ESCALATED" }, kanbanColumnId: { in: idsNovos } },
  };
}

export async function previaSincronizacao(organizationId: string, escopo: EscopoSincronizacao) {
  const alvo = await montarAlvo(organizationId, escopo);
  if ("erro" in alvo) return { escopo, erro: alvo.erro, quantidade: 0 };
  const quantidade = await prisma.lead.count({ where: alvo.whereLead });
  return { escopo, descricao: alvo.descricao, destino: alvo.nomeAlvo, quantidade };
}

export async function aplicarSincronizacao(organizationId: string, escopo: EscopoSincronizacao) {
  const alvo = await montarAlvo(organizationId, escopo);
  if ("erro" in alvo) return { escopo, erro: alvo.erro, movidos: 0 };
  const col = await colunaPorTipo(organizationId, alvo.tipoAlvo);
  if (!col) return { escopo, erro: "coluna de destino sumiu", movidos: 0 };
  const leads = await prisma.lead.findMany({ where: alvo.whereLead, select: { id: true } });
  if (leads.length === 0) return { escopo, destino: col.name, movidos: 0 };
  const ids = leads.map((l) => l.id);
  await prisma.$transaction([
    prisma.lead.updateMany({ where: { id: { in: ids } }, data: { kanbanColumnId: col.id } }),
    prisma.leadActivity.createMany({
      data: ids.map((leadId) => ({
        leadId, type: "STATUS_CHANGE", createdBy: "ADMIN",
        description: `Movido para "${col.name}" pela sincronização do Kanban (${alvo.descricao})`,
      })),
    }),
  ]);
  return { escopo, destino: col.name, movidos: ids.length };
}
