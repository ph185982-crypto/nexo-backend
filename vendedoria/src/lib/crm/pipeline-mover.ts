// ─── Pipeline Mover — movimentação automática de leads no funil Nexo ─────────
//
// Colunas do funil (KanbanColumn.type):
//   CONTATO_1 → CONTATO_2 → CONTATO_3 → PROPOSTA → REUNIAO_AGENDADA →
//   CONTRATO → GANHO | LOST (Perdido) | DESCARTADO
//
// Todas as funções são fail-safe: erros são logados, nunca propagados —
// a movimentação do kanban jamais pode derrubar o fluxo de mensagens.

import { prisma } from "@/lib/prisma/client";
import { normalizeBrazilianNumber } from "@/lib/whatsapp/send";

export type FunilTipo =
  | "CONTATO_1"
  | "CONTATO_2"
  | "CONTATO_3"
  | "PROPOSTA"
  | "REUNIAO_AGENDADA"
  | "CONTRATO"
  | "GANHO"
  | "LOST"
  | "DESCARTADO";

/**
 * Move um lead para a coluna do funil identificada por `tipo`.
 * Se a coluna não existir na org, tenta o fallback (ex.: DESCARTADO → LOST).
 */
export async function moverLeadPorTipo(
  leadId: string,
  organizationId: string,
  tipo: FunilTipo,
  motivo?: string,
  fallback?: FunilTipo,
): Promise<boolean> {
  try {
    let coluna = await prisma.kanbanColumn.findFirst({
      where: { organizationId, type: tipo },
    });
    if (!coluna && fallback) {
      coluna = await prisma.kanbanColumn.findFirst({
        where: { organizationId, type: fallback },
      });
    }
    if (!coluna) {
      console.warn(`[PipelineMover] Coluna ${tipo} não existe na org ${organizationId}`);
      return false;
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { kanbanColumnId: true },
    });
    if (!lead || lead.kanbanColumnId === coluna.id) return false;

    await prisma.lead.update({
      where: { id: leadId },
      data: { kanbanColumnId: coluna.id, lastActivityAt: new Date() },
    });
    await prisma.leadActivity.create({
      data: {
        leadId,
        type: "STATUS_CHANGE",
        description: motivo ?? `Movido automaticamente para "${coluna.name}"`,
        createdBy: "sistema",
      },
    }).catch(() => {});

    console.log(`[PipelineMover] Lead ${leadId} → ${coluna.name} (${tipo})`);
    return true;
  } catch (e) {
    console.error(`[PipelineMover] Erro ao mover lead ${leadId} → ${tipo}:`, e);
    return false;
  }
}

/**
 * Garante que existe um Lead no CRM para um ProspectLead abordado.
 * Busca por telefone normalizado; cria como OUTBOUND na coluna CONTATO_1.
 * Retorna o id do Lead (ou null em falha).
 */
export async function garantirLeadDoProspect(prospect: {
  id: string;
  organizationId: string;
  nome?: string | null;
  telefone?: string | null;
}): Promise<string | null> {
  try {
    if (!prospect.telefone) return null;
    const phone = normalizeBrazilianNumber(prospect.telefone.replace(/\D/g, ""));

    const existente = await prisma.lead.findFirst({
      where: {
        organizationId: prospect.organizationId,
        OR: [{ phoneNumber: phone }, { phoneNumber: prospect.telefone }],
      },
      select: { id: true, prospectLeadId: true },
    });
    if (existente) {
      if (!existente.prospectLeadId) {
        await prisma.lead.update({
          where: { id: existente.id },
          data: { prospectLeadId: prospect.id },
        }).catch(() => {});
      }
      return existente.id;
    }

    const colunaEntrada = await prisma.kanbanColumn.findFirst({
      where: { organizationId: prospect.organizationId, type: "CONTATO_1" },
    }) ?? await prisma.kanbanColumn.findFirst({
      where: { organizationId: prospect.organizationId, isDefaultEntry: true },
    });
    if (!colunaEntrada) {
      console.warn(`[PipelineMover] Sem coluna de entrada na org ${prospect.organizationId}`);
      return null;
    }

    const lead = await prisma.lead.create({
      data: {
        phoneNumber:    phone,
        profileName:    prospect.nome ?? undefined,
        leadOrigin:     "OUTBOUND",
        organizationId: prospect.organizationId,
        kanbanColumnId: colunaEntrada.id,
        prospectLeadId: prospect.id,
      },
    });
    console.log(`[PipelineMover] Lead criado do prospect ${prospect.id}: ${lead.id}`);
    return lead.id;
  } catch (e) {
    console.error(`[PipelineMover] Erro em garantirLeadDoProspect:`, e);
    return null;
  }
}

/**
 * Vincula um Lead inbound recém-criado a um ProspectLead da mesma org
 * pelo telefone (últimos 8 dígitos), se houver.
 */
export async function vincularProspectAoLead(
  leadId: string,
  organizationId: string,
  phone: string,
): Promise<void> {
  try {
    const digits = phone.replace(/\D/g, "");
    const sufixo = digits.slice(-8);
    if (sufixo.length < 8) return;

    const prospect = await prisma.prospectLead.findFirst({
      where: {
        organizationId,
        telefone: { contains: sufixo },
      },
      select: { id: true },
    });
    if (!prospect) return;

    await prisma.lead.update({
      where: { id: leadId },
      data: { prospectLeadId: prospect.id },
    });
    console.log(`[PipelineMover] Lead ${leadId} vinculado ao prospect ${prospect.id}`);
  } catch (e) {
    console.error(`[PipelineMover] Erro em vincularProspectAoLead:`, e);
  }
}

/** Mapeia número da tentativa de contato → tipo de coluna. */
export function colunaPorTentativa(tentativa: number): FunilTipo {
  if (tentativa <= 1) return "CONTATO_1";
  if (tentativa === 2) return "CONTATO_2";
  return "CONTATO_3";
}
