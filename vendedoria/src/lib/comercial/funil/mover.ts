// ─── Único lugar que cria oportunidade ou troca a etapa dela ─────────────────
//
// Cada troca grava, na mesma transação: etapa e funil, relógio da etapa
// (etapaDesdeEm), encerramento (status, encerradaEm, motivo) e uma linha em
// HistoricoEtapa. É isso que mede conversão por etapa, tempo parado e ciclo.
//
// Regra do projeto: nenhum outro arquivo de src/ escreve etapaId/funilId numa
// oportunidade. tests/comercial-funil-guarda.test.ts falha se aparecer um.
//
// Vendedor IA: a etapa conhece a coluna do kanban de Leads equivalente (ComEtapa.kanbanColumnType).
// Mover a oportunidade de um Lead move o Lead junto, na MESMA transação, pelo caminho único do Lead
// (aplicarMudancaDeEtapa); depois do commit roda o mesmo gancho do pipeline (API de Conversões da Meta),
// que não duplica evento (MetaConversionEvent é único por lead e evento).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import { statusDaEtapa, tipoMotivoDaEtapa } from "./encerramento";
import { criarEntregaDaOportunidade } from "@/lib/comercial/entrega/criar";
import { aplicarMudancaDeEtapa, type ColunaRef } from "@/lib/crm/historico-etapa";
import { ALVOS_COLUNA, normalizarNome } from "@/lib/crm/funil-config";
import { aoLeadMudarDeColunaAgendado } from "@/lib/meta-capi-hook";

type Db = Prisma.TransactionClient;

export type OrigemEtapa = "CRIACAO" | "MANUAL" | "INTEGRACAO" | "AUTOMACAO" | "IMPORTACAO";

export interface MudancaEtapa {
  oportunidadeId: string;
  etapaId: string;
  origem: OrigemEtapa;
  /** Quem fez: id do usuário, "vendedor-ia", "automacao"… */
  ator?: string | null;
  /** Texto livre que fica na linha do histórico. */
  motivo?: string | null;
  /** Motivo de ganho/perda do catálogo. Ignorado se o tipo não combina com a etapa ou estiver desativado. */
  motivoId?: string | null;
  motivoDetalhe?: string | null;
  quando?: Date;
}

export interface ResultadoMudanca {
  mudou: boolean;
  /** Natureza da etapa de destino (ABERTA, GANHA, PERDIDA). */
  paraTipo?: string;
  de: { etapaId: string; etapaNome: string; funilNome: string } | null;
  /** O Lead do Vendedor IA mudou de coluna junto (o gancho da Meta roda depois do commit). */
  lead?: { leadId: string; coluna: ColunaRef } | null;
}

/** Coluna do kanban de Leads que corresponde ao tipo da etapa, na organização do lead. */
async function colunaDoLead(tx: Db, organizationId: string, tipo: string): Promise<ColunaRef | null> {
  const colunas = await tx.kanbanColumn.findMany({ where: { organizationId }, orderBy: { order: "asc" }, select: { id: true, name: true, type: true } });
  const direta = colunas.find((c) => c.type === tipo);
  if (direta) return direta;
  const cfg = ALVOS_COLUNA[tipo];
  for (const t of cfg?.tipos ?? []) { const c = colunas.find((x) => x.type === t); if (c) return c; }
  for (const n of cfg?.nomes ?? []) { const c = colunas.find((x) => normalizarNome(x.name) === n); if (c) return c; }
  return null;
}

/** Leva o Lead para a coluna da etapa, na mesma transação. Sem Lead, sem coluna equivalente ou já nela: nada. */
async function sincronizarLead(
  tx: Db, leadId: string | null, kanbanColumnType: string | null,
  m: { ator?: string | null; motivo?: string | null; motivoId: string | null; motivoDetalhe?: string | null; quando: Date },
): Promise<ResultadoMudanca["lead"]> {
  if (!leadId || !kanbanColumnType) return null;
  const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { organizationId: true } });
  if (!lead) return null;
  const coluna = await colunaDoLead(tx, lead.organizationId, kanbanColumnType);
  if (!coluna) return null;
  const r = await aplicarMudancaDeEtapa({
    leadId, coluna, origem: "COMERCIAL", ator: m.ator ?? null, motivo: m.motivo ?? "Oportunidade movida no Comercial",
    motivoEncerramentoId: m.motivoId, motivoDetalhe: m.motivoDetalhe ?? null, dadosLead: { lastActivityAt: m.quando }, quando: m.quando,
  }, tx);
  return r.mudou ? { leadId, coluna } : null;
}

/** Depois do commit: o mesmo gancho do pipeline do Lead (Meta CAPI). Nunca lança. */
async function depoisDoLead(lead: ResultadoMudanca["lead"]) {
  if (!lead) return;
  try { await aoLeadMudarDeColunaAgendado(lead.leadId, { type: lead.coluna.type, name: lead.coluna.name }); } catch (e) { console.error("[comercial] gancho do lead falhou:", e); }
}

export async function moverOportunidade(m: MudancaEtapa, db?: Db): Promise<ResultadoMudanca> {
  const run = async (tx: Db): Promise<ResultadoMudanca> => {
    const [op, destino] = await Promise.all([
      tx.comOportunidade.findUnique({
        where: { id: m.oportunidadeId },
        select: { etapaId: true, etapaDesdeEm: true, leadId: true, etapa: { select: { id: true, nome: true, tipo: true, funil: { select: { nome: true } } } } },
      }),
      tx.comEtapa.findUnique({ where: { id: m.etapaId }, select: { id: true, nome: true, tipo: true, funilId: true, kanbanColumnType: true, funil: { select: { nome: true, ativo: true } } } }),
    ]);
    if (!op) throw new Error("Oportunidade não encontrada");
    if (!destino) throw new Error("Etapa não encontrada");
    const de = { etapaId: op.etapa.id, etapaNome: op.etapa.nome, funilNome: op.etapa.funil.nome };
    if (op.etapaId === destino.id) return { mudou: false, de, paraTipo: destino.tipo };
    if (!destino.funil.ativo) throw new Error("Funil desativado");

    const agora = m.quando ?? new Date();
    const fechadas = await tx.comHistoricoEtapa.updateMany({ where: { oportunidadeId: m.oportunidadeId, saiuEm: null }, data: { saiuEm: agora } });
    if (fechadas.count === 0) {
      // sem linha aberta (importada, ou criada por caminho esquecido): reconstrói a etapa anterior
      await tx.comHistoricoEtapa.create({
        data: {
          oportunidadeId: m.oportunidadeId, paraEtapaId: op.etapa.id, paraFunilNome: de.funilNome, paraEtapaNome: de.etapaNome,
          paraTipo: op.etapa.tipo, entrouEm: op.etapaDesdeEm, saiuEm: agora, origem: "IMPORTACAO",
        },
      });
    }
    await tx.comHistoricoEtapa.create({
      data: {
        oportunidadeId: m.oportunidadeId,
        deEtapaId: de.etapaId, deFunilNome: de.funilNome, deEtapaNome: de.etapaNome,
        paraEtapaId: destino.id, paraFunilNome: destino.funil.nome, paraEtapaNome: destino.nome, paraTipo: destino.tipo,
        entrouEm: agora, origem: m.origem, ator: m.ator ?? null, motivo: m.motivo ?? null,
      },
    });

    const tipoNovo = tipoMotivoDaEtapa(destino.tipo);
    const tipoAntigo = tipoMotivoDaEtapa(op.etapa.tipo);
    let motivoValido: string | null = null;
    if (m.motivoId && tipoNovo) {
      const cat = await tx.motivoEncerramento.findUnique({ where: { id: m.motivoId } });
      if (cat && cat.ativo && cat.tipo === tipoNovo) motivoValido = cat.id;
    }
    // Trocar de natureza (aberta → ganha, perdida → ganha…) invalida o motivo anterior.
    const motivoMuda = motivoValido !== null || tipoNovo !== tipoAntigo;

    await tx.comOportunidade.update({
      where: { id: m.oportunidadeId },
      data: {
        etapaId: destino.id,
        funilId: destino.funilId,
        status: statusDaEtapa(destino.tipo),
        etapaDesdeEm: agora,
        encerradaEm: tipoNovo ? agora : null,
        ultimaAtividadeEm: agora,
        ...(motivoMuda && { motivoId: motivoValido, motivoDetalhe: motivoValido ? (m.motivoDetalhe?.trim().slice(0, 500) || null) : null }),
      },
    });
    // Ganhou: a entrega nasce na mesma transação (idempotente: ganhar de novo não duplica).
    if (destino.tipo === "GANHA") await criarEntregaDaOportunidade(tx, m.oportunidadeId, agora);
    const lead = await sincronizarLead(tx, op.leadId, destino.kanbanColumnType, {
      ator: m.ator, motivo: m.motivo, motivoId: motivoValido, motivoDetalhe: m.motivoDetalhe, quando: agora,
    });
    return { mudou: true, de, paraTipo: destino.tipo, lead };
  };
  if (db) return run(db); // quem passa a transação chama depoisDoLead(r.lead) depois do commit
  const r = await prisma.$transaction(run);
  await depoisDoLead(r.lead);
  // Automações disparam depois de confirmar a transação; as de ação de automação não encadeiam (sem laço).
  if (r.mudou && m.origem !== "AUTOMACAO") await dispararAutomacoes(m.oportunidadeId, r.paraTipo ?? "ABERTA", false);
  if (r.mudou && r.paraTipo === "GANHA") await levarCombinados(m.oportunidadeId);
  return r;
}

/** Ganhou: o que foi combinado na negociação vira cartão da entrega. Depois do commit; nunca derruba quem chamou. */
async function levarCombinados(oportunidadeId: string) {
  try {
    const { levarCombinadosParaEntrega } = await import("@/lib/comercial/combinados/servico");
    await levarCombinadosParaEntrega(oportunidadeId);
  } catch (e) {
    console.error("[combinados] falha ao levar para a entrega:", e);
  }
}

/** Depois do commit; nunca derruba quem chamou. Import dinâmico: o motor importa este módulo. */
async function dispararAutomacoes(oportunidadeId: string, paraTipo: string, criada: boolean) {
  try {
    const { dispararEvento, gatilhosDaMudanca } = await import("@/lib/comercial/automacao/motor");
    if (criada) await dispararEvento("OPORTUNIDADE_CRIADA", oportunidadeId);
    else for (const g of gatilhosDaMudanca(paraTipo)) await dispararEvento(g, oportunidadeId);
  } catch (e) {
    console.error("[automacao] falha ao disparar:", e);
  }
}

export { depoisDoLead };

export interface NovaOportunidade {
  nome: string;
  contatoId: string;
  pessoaId?: string | null;
  /** Funil de entrada; se faltar, o funil padrão. */
  funilId?: string | null;
  /** Etapa de entrada; se faltar, a primeira etapa aberta do funil. */
  etapaId?: string | null;
  responsavelId?: string | null;
  valorUnico?: number;
  valorMensal?: number;
  probabilidade?: string | null;
  origem?: string | null;
  tags?: string[];
  finalizaEm?: Date | null;
  leadId?: string | null;
  origemHistorico?: OrigemEtapa;
  ator?: string | null;
}

export async function criarOportunidade(n: NovaOportunidade, db?: Db) {
  const run = async (tx: Db) => {
    let etapa;
    if (n.etapaId) {
      etapa = await tx.comEtapa.findUnique({ where: { id: n.etapaId }, include: { funil: true } });
    } else {
      const funil = n.funilId
        ? await tx.comFunil.findUnique({ where: { id: n.funilId } })
        : await tx.comFunil.findFirst({ where: { padrao: true, ativo: true }, orderBy: { ordem: "asc" } });
      if (!funil) throw new Error("Funil não encontrado");
      etapa = await tx.comEtapa.findFirst({ where: { funilId: funil.id, tipo: "ABERTA" }, orderBy: { ordem: "asc" }, include: { funil: true } });
    }
    if (!etapa) throw new Error("Etapa de entrada não encontrada");
    const agora = new Date();
    const encerra = tipoMotivoDaEtapa(etapa.tipo) !== null;
    const op = await tx.comOportunidade.create({
      data: {
        nome: n.nome.trim(),
        contatoId: n.contatoId,
        pessoaId: n.pessoaId ?? null,
        funilId: etapa.funilId,
        etapaId: etapa.id,
        status: statusDaEtapa(etapa.tipo),
        responsavelId: n.responsavelId ?? null,
        valorUnico: n.valorUnico ?? 0,
        valorMensal: n.valorMensal ?? 0,
        probabilidade: n.probabilidade ?? null,
        origem: n.origem ?? null,
        tags: n.tags ?? [],
        finalizaEm: n.finalizaEm ?? null,
        leadId: n.leadId ?? null,
        etapaDesdeEm: agora,
        ultimaAtividadeEm: agora,
        encerradaEm: encerra ? agora : null,
      },
    });
    await tx.comHistoricoEtapa.create({
      data: {
        oportunidadeId: op.id, paraEtapaId: etapa.id, paraFunilNome: etapa.funil.nome, paraEtapaNome: etapa.nome,
        paraTipo: etapa.tipo, entrouEm: agora, origem: n.origemHistorico ?? "CRIACAO", ator: n.ator ?? null,
      },
    });
    if (etapa.tipo === "GANHA") await criarEntregaDaOportunidade(tx, op.id, agora); // criada já ganha
    return op;
  };
  if (db) return run(db);
  const op = await prisma.$transaction(run);
  if (n.origemHistorico !== "AUTOMACAO") await dispararAutomacoes(op.id, "ABERTA", true); // depois do commit
  return op;
}
