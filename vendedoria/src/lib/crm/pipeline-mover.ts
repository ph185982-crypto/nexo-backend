// ─── Pipeline Mover — movimentação automática de leads no funil Nexo ─────────
//
// Funil unificado em 5 etapas (era 14 colunas espalhadas em dois sub-funis
// sobrepostos — qualificação do SDR + prospecção outbound — dificultando ver
// de relance onde cada contato está):
//   Novo → Em Qualificação → Qualificado → Ganho | Perdido
//
// Todo o código continua chamando moverLeadPorTipo com os tipos antigos e mais
// granulares (MORNO, PROPOSTA, REUNIAO_AGENDADA, CONTATO_2, etc.) — o mapa
// CANONICO abaixo traduz cada um pra uma das 5 colunas reais antes de buscar
// no banco, então nenhum call site precisou mudar. O detalhe fino (em qual
// tentativa de contato, se tem reunião marcada) continua registrado em
// LeadActivity/ProspectLead.tentativasDisparo — só deixou de virar uma coluna
// própria no board.
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
  | "DESCARTADO"
  // Funil de qualificação do SDR inbound (src/lib/ai/sdr/agent.ts)
  | "EM_QUALIFICACAO"
  | "QUALIFICADO"
  | "MORNO"
  | "ESCALATED";

/** As 5 colunas que de fato existem no board — tudo mais é canonicalizado pra uma delas. */
export type FunilCanonico = "TRIAGE" | "EM_QUALIFICACAO" | "QUALIFICADO" | "GANHO" | "LOST";

const MAPA_CANONICO: Record<FunilTipo | FunilCanonico, FunilCanonico> = {
  TRIAGE: "TRIAGE",
  CONTATO_1: "TRIAGE",
  CONTATO_2: "TRIAGE",
  CONTATO_3: "TRIAGE",
  EM_QUALIFICACAO: "EM_QUALIFICACAO",
  MORNO: "EM_QUALIFICACAO",
  QUALIFICADO: "QUALIFICADO",
  ESCALATED: "QUALIFICADO",
  PROPOSTA: "QUALIFICADO",
  REUNIAO_AGENDADA: "QUALIFICADO",
  CONTRATO: "QUALIFICADO",
  GANHO: "GANHO",
  LOST: "LOST",
  DESCARTADO: "LOST",
};

export function canonicalizarTipo(tipo: string): FunilCanonico {
  return (MAPA_CANONICO as Record<string, FunilCanonico>)[tipo] ?? "TRIAGE";
}

/**
 * Move um lead para a coluna do funil identificada por `tipo` — canonicalizado
 * para uma das 5 colunas reais antes da busca (ver MAPA_CANONICO acima).
 */
export async function moverLeadPorTipo(
  leadId: string,
  organizationId: string,
  tipo: FunilTipo,
  motivo?: string,
  fallback?: FunilTipo,
): Promise<boolean> {
  try {
    const alvo = canonicalizarTipo(tipo);
    let coluna = await prisma.kanbanColumn.findFirst({
      where: { organizationId, type: alvo },
    });
    if (!coluna && fallback) {
      coluna = await prisma.kanbanColumn.findFirst({
        where: { organizationId, type: canonicalizarTipo(fallback) },
      });
    }
    if (!coluna) {
      console.warn(`[PipelineMover] Coluna ${alvo} (de ${tipo}) não existe na org ${organizationId}`);
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

    console.log(`[PipelineMover] Lead ${leadId} → ${coluna.name} (${tipo} → ${alvo})`);

    // Ao mover para GANHO: cria rascunho do diagnóstico se ainda não existir
    if (tipo === "GANHO") {
      prisma.clientDiagnosis.upsert({
        where: { leadId },
        create: { leadId },
        update: {},
      }).catch(() => {});
    }

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
      where: { organizationId: prospect.organizationId, type: canonicalizarTipo("CONTATO_1") },
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

const COLUNAS_CANONICAS: Array<{ type: FunilCanonico; name: string; order: number; color: string; isDefaultEntry?: boolean }> = [
  { type: "TRIAGE",           name: "Novo",             order: 0, color: "#6B7280", isDefaultEntry: true },
  { type: "EM_QUALIFICACAO",  name: "Em Qualificação",  order: 1, color: "#3B82F6" },
  { type: "QUALIFICADO",      name: "Qualificado",      order: 2, color: "#10B981" },
  { type: "GANHO",            name: "Ganho",            order: 3, color: "#22C55E" },
  { type: "LOST",             name: "Perdido",          order: 4, color: "#EF4444" },
];

/**
 * Garante que a org tenha exatamente as 5 colunas do funil unificado, e funde
 * qualquer coluna legada (dos 14 tipos antigos, ou CUSTOM com nome legado de
 * uma versão ainda mais antiga do bootstrap) na canônica correspondente antes
 * de apagá-la — sem perder nenhum lead que estava nela.
 *
 * Idempotente e fail-safe: seguro chamar em toda execução do bootstrap.
 */
export async function consolidarColunasEm5Etapas(organizationId: string): Promise<void> {
  try {
    // 1) Garante que as 5 colunas canônicas existem.
    const existentes = await prisma.kanbanColumn.findMany({ where: { organizationId } });
    const porTipo = new Map(existentes.map((c) => [c.type, c]));

    const faltando = COLUNAS_CANONICAS.filter((c) => !porTipo.has(c.type));
    if (faltando.length > 0) {
      await prisma.kanbanColumn.createMany({
        data: faltando.map((c) => ({ ...c, organizationId, isSystemDefault: true })),
      });
      console.log(`[PipelineMover] Colunas canônicas criadas: ${faltando.map((c) => c.type).join(", ")}`);
      // Recarrega para ter os ids das recém-criadas.
      existentes.push(
        ...(await prisma.kanbanColumn.findMany({
          where: { organizationId, type: { in: faltando.map((c) => c.type) } },
        })),
      );
      for (const c of existentes) porTipo.set(c.type, c);
    }

    // 2) Repara colunas CUSTOM de versões antigas do bootstrap, identificadas
    //    por nome (o type não distinguia qual coluna era qual).
    const legacyRenamePorNome: Record<string, FunilTipo> = {
      "Em qualificação": "EM_QUALIFICACAO",
      "Qualificados": "QUALIFICADO",
      "Mornos": "MORNO",
    };
    const customLegado = existentes.filter(
      (c) => c.type === "CUSTOM" && legacyRenamePorNome[c.name],
    );
    for (const col of customLegado) {
      col.type = legacyRenamePorNome[col.name];
    }

    // 3) Funde toda coluna cujo tipo não seja uma das 5 canônicas: move os
    //    leads pra coluna canônica correspondente e apaga a coluna antiga.
    const tiposCanonicos = new Set(COLUNAS_CANONICAS.map((c) => c.type as string));
    for (const legada of existentes) {
      if (tiposCanonicos.has(legada.type)) continue; // já é uma das 5 — mantém

      const alvoTipo = canonicalizarTipo(legada.type);
      const colunaDestino = porTipo.get(alvoTipo);
      if (!colunaDestino) continue; // não deveria acontecer após o passo 1

      const { count } = await prisma.lead.updateMany({
        where: { kanbanColumnId: legada.id },
        data: { kanbanColumnId: colunaDestino.id },
      });
      await prisma.kanbanColumn.delete({ where: { id: legada.id } }).catch((e) =>
        console.error(`[PipelineMover] Falha ao remover coluna legada ${legada.name}:`, e),
      );
      console.log(`[PipelineMover] Coluna legada "${legada.name}" (${legada.type}) fundida em "${colunaDestino.name}" — ${count} lead(s) movido(s)`);
    }
  } catch (e) {
    console.error(`[PipelineMover] Erro ao consolidar colunas da org ${organizationId}:`, e);
  }
}
