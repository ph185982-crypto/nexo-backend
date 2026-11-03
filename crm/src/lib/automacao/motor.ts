// Motor de automações. Eventos disparam na hora; "estagnada" e "sem interação" por varredura agendada.
// Cada ação vira uma linha em AutomacaoExecucao com chave única (o mesmo fato nunca roda duas vezes)
// e horário (espera). Automação NÃO dispara a partir de ação de automação: sem laço.
import { prisma } from "@/lib/prisma";
import { executarAcao } from "./acoes";
import { avaliarCriterios, contextoDaOportunidade } from "./criterios";
import { GATILHOS_DE_TEMPO, type Acao, type Criterio, type Gatilho } from "./modelo";

const INCLUIR_OPORTUNIDADE = { contato: { select: { id: true, nome: true } }, etapa: { select: { nome: true, tipo: true, funil: { select: { nome: true } } } } } as const;

interface AutomacaoRegistro { id: string; nome: string; gatilho: string; criterios: unknown; acoes: unknown }

async function agendar(a: AutomacaoRegistro, oportunidadeId: string, marcador: string, agora: Date): Promise<number> {
  const acoes = a.acoes as Acao[];
  const r = await prisma.automacaoExecucao.createMany({
    data: acoes.map((ac, i) => ({
      automacaoId: a.id, oportunidadeId, gatilho: a.gatilho, indice: i, acaoTipo: ac.tipo,
      chave: `${a.id}:${oportunidadeId}:${a.gatilho}:${marcador}:${i}`, executarEm: new Date(agora.getTime() + (ac.esperaHoras ?? 0) * 3_600_000),
    })),
    skipDuplicates: true,
  });
  return r.count;
}

/** Evento de uma oportunidade (criada, movida, ganha, perdida). Devolve quantas ações foram agendadas e já processa as vencidas. */
export async function dispararEvento(gatilho: Gatilho, oportunidadeId: string, agora: Date = new Date()): Promise<{ agendadas: number }> {
  const automacoes = await prisma.automacao.findMany({ where: { ativo: true, gatilho } });
  if (automacoes.length === 0) return { agendadas: 0 };
  const op = await prisma.oportunidade.findUnique({ where: { id: oportunidadeId } });
  if (!op) return { agendadas: 0 };
  const ctx = contextoDaOportunidade(op, agora);
  // etapaDesdeEm identifica o fato (cada mudança de etapa a renova; na criação é a própria criação).
  const marcador = String(op.etapaDesdeEm.getTime());
  let agendadas = 0;
  for (const a of automacoes) if (avaliarCriterios(a.criterios as unknown as Criterio[], ctx)) agendadas += await agendar(a, op.id, marcador, agora);
  if (agendadas > 0) await processarVencidas(agora);
  return { agendadas };
}

/** Eventos que uma mudança de etapa gera. */
export const gatilhosDaMudanca = (paraTipo: string): Gatilho[] => ["OPORTUNIDADE_MOVIDA", ...(paraTipo === "GANHA" ? ["OPORTUNIDADE_GANHA" as const] : paraTipo === "PERDIDA" ? ["OPORTUNIDADE_PERDIDA" as const] : [])];

/** Procura oportunidades em andamento que se encaixam nas automações de tempo. Roda de hora em hora ou por demanda. */
export async function varrerTempo(agora: Date = new Date()): Promise<{ avaliadas: number; agendadas: number }> {
  const automacoes = await prisma.automacao.findMany({ where: { ativo: true, gatilho: { in: [...GATILHOS_DE_TEMPO] } } });
  if (automacoes.length === 0) return { avaliadas: 0, agendadas: 0 };
  const ops = await prisma.oportunidade.findMany({ where: { status: "EM_ANDAMENTO" } });
  let agendadas = 0;
  for (const op of ops) {
    const ctx = contextoDaOportunidade(op, agora);
    for (const a of automacoes) {
      if (!avaliarCriterios(a.criterios as unknown as Criterio[], ctx)) continue;
      // Parada: uma vez por permanência na etapa. Sem interação: uma vez por período sem atividade.
      const marcador = String(a.gatilho === "OPORTUNIDADE_ESTAGNADA" ? op.etapaDesdeEm.getTime() : op.ultimaAtividadeEm.getTime());
      agendadas += await agendar(a, op.id, marcador, agora);
    }
  }
  return { avaliadas: ops.length, agendadas };
}

/** Executa as ações que já venceram. Cada linha é reivindicada antes (execuções simultâneas não duplicam). */
export async function processarVencidas(agora: Date = new Date(), limite = 50): Promise<{ executadas: number; ignoradas: number; erros: number }> {
  // Linha reivindicada há mais de 10 min e nunca concluída = processo caiu no meio: volta para a fila.
  await prisma.automacaoExecucao.updateMany({ where: { status: "EXECUTANDO", executarEm: { lt: new Date(agora.getTime() - 10 * 60_000) } }, data: { status: "PENDENTE" } });
  const res = { executadas: 0, ignoradas: 0, erros: 0 };
  const devidas = await prisma.automacaoExecucao.findMany({ where: { status: "PENDENTE", executarEm: { lte: agora } }, orderBy: { executarEm: "asc" }, take: limite });
  for (const e of devidas) {
    const claim = await prisma.automacaoExecucao.updateMany({ where: { id: e.id, status: "PENDENTE" }, data: { status: "EXECUTANDO", executarEm: agora } });
    if (claim.count === 0) continue;
    const finalizar = (status: "EXECUTADA" | "IGNORADA" | "ERRO", detalhe: string) =>
      prisma.automacaoExecucao.update({ where: { id: e.id }, data: { status, detalhe: detalhe.slice(0, 500), executadaEm: new Date() } });
    try {
      const a = await prisma.automacao.findUnique({ where: { id: e.automacaoId } });
      const op = e.oportunidadeId ? await prisma.oportunidade.findUnique({ where: { id: e.oportunidadeId }, include: INCLUIR_OPORTUNIDADE }) : null;
      if (!a || !a.ativo) { await finalizar("IGNORADA", "Automação desativada ou removida"); res.ignoradas++; continue; }
      if (!op) { await finalizar("IGNORADA", "Oportunidade não existe mais"); res.ignoradas++; continue; }
      const acao = (a.acoes as unknown as Acao[])[e.indice];
      if (!acao) { await finalizar("IGNORADA", "Ação não existe mais na automação"); res.ignoradas++; continue; }
      // Ação com espera: confere de novo se a oportunidade ainda se encaixa (ex.: ainda parada na etapa).
      if ((acao.esperaHoras ?? 0) > 0 && !avaliarCriterios(a.criterios as unknown as Criterio[], contextoDaOportunidade(op, agora)) && !["OPORTUNIDADE_GANHA", "OPORTUNIDADE_PERDIDA"].includes(a.gatilho)) {
        await finalizar("IGNORADA", "Os critérios não valiam mais depois da espera"); res.ignoradas++; continue;
      }
      await finalizar("EXECUTADA", await executarAcao(acao, op, { id: a.id, nome: a.nome }, a.gatilho, agora));
      res.executadas++;
    } catch (err) {
      await finalizar("ERRO", err instanceof Error ? err.message : String(err));
      res.erros++;
    }
  }
  return res;
}
