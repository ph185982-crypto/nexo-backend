// ─── Histórico de etapa do funil ─────────────────────────────────────────────
//
// Único lugar que troca a coluna (etapa) de um lead. Cada troca grava, na mesma
// transação: a nova coluna, o relógio da etapa (Lead.etapaDesdeEm), o
// encerramento (Lead.encerradoEm / motivo) e uma linha em LeadStageHistory.
// É isso que permite medir conversão por etapa, tempo parado e ciclo de vendas.
//
// Regra do projeto: nenhum outro arquivo de src/ escreve `kanbanColumnId` num
// lead existente. tests/historico-etapa.test.ts falha se aparecer um.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import { tipoEncerramento } from "@/lib/crm/encerramento";

export { tipoEncerramento };
export type { TipoEncerramento } from "@/lib/crm/encerramento";

type Db = Prisma.TransactionClient;

export type OrigemEtapa = "CRIACAO" | "PIPELINE" | "MANUAL" | "IA" | "SINCRONIZACAO" | "BACKFILL";

export interface ColunaRef {
  id: string;
  name: string;
  type: string;
}

type DadosLeadExtras = Omit<
  Prisma.LeadUncheckedUpdateInput,
  "kanbanColumnId" | "etapaDesdeEm" | "encerradoEm" | "motivoEncerramentoId" | "motivoDetalhe"
>;

export interface MudancaEtapa {
  leadId: string;
  coluna: ColunaRef;
  origem: OrigemEtapa;
  /** Quem fez: id do usuário, "AI_AGENT", "sistema"… */
  ator?: string | null;
  /** Texto livre que fica na linha do histórico. */
  motivo?: string | null;
  /** Motivo de ganho/perda do catálogo. Ignorado se não combinar com a coluna ou com a organização. */
  motivoEncerramentoId?: string | null;
  motivoDetalhe?: string | null;
  /** Outros campos do lead gravados junto (status, lastActivityAt…). Aplicados mesmo se já estiver na coluna. */
  dadosLead?: DadosLeadExtras;
  quando?: Date;
}

export interface ResultadoMudanca {
  mudou: boolean;
  de: ColunaRef | null;
}

/**
 * Move o lead para `coluna` e registra a passagem. Se já está nela, só aplica
 * `dadosLead` e devolve `mudou: false` (o histórico não ganha linha).
 * Passe `db` para participar de uma transação existente.
 */
export async function aplicarMudancaDeEtapa(m: MudancaEtapa, db?: Db): Promise<ResultadoMudanca> {
  const run = async (tx: Db): Promise<ResultadoMudanca> => {
    const lead = await tx.lead.findUnique({
      where: { id: m.leadId },
      select: {
        organizationId: true,
        kanbanColumnId: true,
        etapaDesdeEm: true,
        kanbanColumn: { select: { id: true, name: true, type: true } },
      },
    });
    if (!lead) return { mudou: false, de: null };
    const de = lead.kanbanColumn;

    if (lead.kanbanColumnId === m.coluna.id) {
      if (m.dadosLead) await tx.lead.update({ where: { id: m.leadId }, data: m.dadosLead });
      return { mudou: false, de };
    }

    const agora = m.quando ?? new Date();

    // Fecha a etapa que estava aberta. Lead sem linha aberta (criado antes do
    // histórico existir, ou por um caminho esquecido) ganha uma linha de
    // reconstrução para o tempo na etapa anterior não se perder.
    const fechadas = await tx.leadStageHistory.updateMany({
      where: { leadId: m.leadId, exitedAt: null },
      data: { exitedAt: agora },
    });
    if (fechadas.count === 0) {
      await tx.leadStageHistory.create({
        data: {
          leadId: m.leadId, toColumnId: de.id, toName: de.name, toType: de.type,
          enteredAt: lead.etapaDesdeEm, exitedAt: agora, origem: "BACKFILL",
        },
      });
    }

    await tx.leadStageHistory.create({
      data: {
        leadId: m.leadId,
        fromColumnId: de.id, fromName: de.name,
        toColumnId: m.coluna.id, toName: m.coluna.name, toType: m.coluna.type,
        enteredAt: agora,
        origem: m.origem,
        ator: m.ator ?? null,
        motivo: m.motivo ?? null,
      },
    });

    const novo = tipoEncerramento(m.coluna.type);
    const antigo = tipoEncerramento(de.type);

    // Motivo: só vale se é do catálogo desta organização e do tipo certo.
    let motivoValido: string | null = null;
    if (m.motivoEncerramentoId && novo) {
      const cat = await tx.motivoEncerramento.findUnique({ where: { id: m.motivoEncerramentoId } });
      if (cat && cat.organizationId === lead.organizationId && cat.tipo === novo && cat.ativo) motivoValido = cat.id;
    }
    // Trocar de natureza (aberto → ganho, perda → ganho…) invalida o motivo anterior.
    const motivoMuda = motivoValido !== null || novo !== antigo;

    await tx.lead.update({
      where: { id: m.leadId },
      data: {
        ...m.dadosLead,
        kanbanColumnId: m.coluna.id,
        etapaDesdeEm: agora,
        encerradoEm: novo ? agora : null,
        ...(motivoMuda && {
          motivoEncerramentoId: motivoValido,
          motivoDetalhe: motivoValido ? (m.motivoDetalhe?.trim().slice(0, 500) || null) : null,
        }),
      },
    });

    return { mudou: true, de };
  };

  return db ? run(db) : prisma.$transaction(run);
}

/**
 * Move vários leads de uma vez para a mesma coluna (manutenção do kanban).
 * Uma transação, poucas consultas — serve para milhares de leads.
 * Leads que já estão na coluna são ignorados. Devolve quantos foram movidos.
 */
export async function aplicarMudancaDeEtapaEmLote(
  m: { leadIds: string[]; coluna: ColunaRef; origem: OrigemEtapa; ator?: string | null; motivo?: string | null },
): Promise<number> {
  if (m.leadIds.length === 0) return 0;
  return prisma.$transaction(async (tx) => {
    const leads = await tx.lead.findMany({
      where: { id: { in: m.leadIds }, kanbanColumnId: { not: m.coluna.id } },
      select: { id: true, etapaDesdeEm: true, kanbanColumn: { select: { id: true, name: true, type: true } } },
    });
    if (leads.length === 0) return 0;
    const ids = leads.map((l) => l.id);
    const agora = new Date();

    const abertas = new Set(
      (await tx.leadStageHistory.findMany({
        where: { leadId: { in: ids }, exitedAt: null },
        select: { leadId: true },
      })).map((r) => r.leadId),
    );
    await tx.leadStageHistory.updateMany({ where: { leadId: { in: ids }, exitedAt: null }, data: { exitedAt: agora } });

    await tx.leadStageHistory.createMany({
      data: [
        // reconstrução para quem não tinha linha aberta
        ...leads.filter((l) => !abertas.has(l.id)).map((l) => ({
          leadId: l.id, toColumnId: l.kanbanColumn.id, toName: l.kanbanColumn.name, toType: l.kanbanColumn.type,
          enteredAt: l.etapaDesdeEm, exitedAt: agora, origem: "BACKFILL",
        })),
        ...leads.map((l) => ({
          leadId: l.id,
          fromColumnId: l.kanbanColumn.id, fromName: l.kanbanColumn.name,
          toColumnId: m.coluna.id, toName: m.coluna.name, toType: m.coluna.type,
          enteredAt: agora, origem: m.origem, ator: m.ator ?? null, motivo: m.motivo ?? null,
        })),
      ],
    });

    const novo = tipoEncerramento(m.coluna.type);
    const base = { kanbanColumnId: m.coluna.id, etapaDesdeEm: agora, encerradoEm: novo ? agora : null };
    // Quem muda de natureza perde o motivo; quem continua na mesma natureza o mantém.
    const mudaNatureza = ids.filter((id) => tipoEncerramento(leads.find((l) => l.id === id)!.kanbanColumn.type) !== novo);
    const mesmaNatureza = ids.filter((id) => !mudaNatureza.includes(id));
    if (mudaNatureza.length) {
      await tx.lead.updateMany({
        where: { id: { in: mudaNatureza } },
        data: { ...base, motivoEncerramentoId: null, motivoDetalhe: null },
      });
    }
    if (mesmaNatureza.length) await tx.lead.updateMany({ where: { id: { in: mesmaNatureza } }, data: base });
    return ids.length;
  });
}

/**
 * Lead recém-criado: abre a primeira linha do histórico na coluna de entrada.
 * Nunca lança — falha aqui não pode impedir o atendimento de um lead novo.
 */
export async function registrarCriacaoLead(
  m: { leadId: string; coluna: ColunaRef; origem?: OrigemEtapa; ator?: string | null },
  db?: Db,
): Promise<void> {
  const run = async (tx: Db) => {
    if ((await tx.leadStageHistory.count({ where: { leadId: m.leadId } })) > 0) return;
    const lead = await tx.lead.findUnique({ where: { id: m.leadId }, select: { etapaDesdeEm: true } });
    if (!lead) return;
    await tx.leadStageHistory.create({
      data: {
        leadId: m.leadId, toColumnId: m.coluna.id, toName: m.coluna.name, toType: m.coluna.type,
        enteredAt: lead.etapaDesdeEm, origem: m.origem ?? "CRIACAO", ator: m.ator ?? null,
      },
    });
    if (tipoEncerramento(m.coluna.type)) {
      await tx.lead.update({ where: { id: m.leadId }, data: { encerradoEm: lead.etapaDesdeEm } });
    }
  };
  try {
    await (db ? run(db) : prisma.$transaction(run));
  } catch (e) {
    console.error(`[HistoricoEtapa] Falha ao registrar criação do lead ${m.leadId}:`, e);
  }
}

/**
 * Fusão de coluna legada: os leads passam para a coluna que absorveu a antiga e
 * a etapa aberta de cada um passa a apontar para ela, sem reiniciar o relógio.
 * As linhas já fechadas ficam como eram — guardam o nome da época.
 * Estrutural, não é movimento de negócio: não cria linha de histórico.
 * Devolve quantos leads foram reapontados.
 */
export async function fundirColuna(deColunaId: string, para: ColunaRef): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.lead.updateMany({
      where: { kanbanColumnId: deColunaId },
      data: { kanbanColumnId: para.id },
    });
    await tx.leadStageHistory.updateMany({
      where: { toColumnId: deColunaId, exitedAt: null },
      data: { toColumnId: para.id, toName: para.name, toType: para.type },
    });
    return count;
  });
}
