// Motor de automações. Eventos disparam na hora; "estagnada", "sem interação" e os gatilhos de tempo da entrega
// (cartão atrasado, aguardando o cliente, cliente em risco, renovação chegando) por varredura agendada.
// Cada ação vira uma linha em AutomacaoExecucao com chave única (o mesmo fato nunca roda duas vezes)
// e horário (espera). Automação NÃO dispara a partir de ação de automação: sem laço.
import { prisma } from "@/lib/prisma";
import { depoisDaResposta } from "@/lib/segundo-plano";
import { executarAcao, type ContextoDaAcao } from "./acoes";
import { avaliarCriterios, contextoDaEntrega, contextoDaOportunidade, type ContextoOportunidade } from "./criterios";
import { GATILHOS_DE_CARTAO, GATILHOS_DE_ENTREGA, GATILHOS_DE_TEMPO, ehGatilhoDeEntrega, type Acao, type Criterio, type Gatilho } from "./modelo";

const INCLUIR_OPORTUNIDADE = { contato: { select: { id: true, nome: true } }, etapa: { select: { nome: true, tipo: true, funil: { select: { nome: true } } } } } as const;
const CAMPOS_CARTAO = { id: true, titulo: true, coluna: true, dataAlvo: true, colunaDesdeEm: true, concluidoEm: true, pilar: true, cliente: true, responsavelId: true } as const;
const SEMANA = 7 * 86_400_000;

interface AutomacaoRegistro { id: string; nome: string; gatilho: string; criterios: unknown; acoes: unknown }

async function agendar(a: AutomacaoRegistro, oportunidadeId: string, marcador: string, agora: Date, referenciaId: string | null = null): Promise<number> {
  const acoes = a.acoes as Acao[];
  const r = await prisma.automacaoExecucao.createMany({
    data: acoes.map((ac, i) => ({
      automacaoId: a.id, oportunidadeId, referenciaId, gatilho: a.gatilho, indice: i, acaoTipo: ac.tipo,
      chave: `${a.id}:${oportunidadeId}:${a.gatilho}:${marcador}:${i}`, executarEm: new Date(agora.getTime() + (ac.esperaHoras ?? 0) * 3_600_000),
    })),
    skipDuplicates: true,
  });
  return r.count;
}

/** Na requisição do usuário só roda o que é rápido e desta oportunidade; o webhook (até 8 s) vai para depois da resposta. */
async function processarDaOportunidade(oportunidadeId: string, agora: Date) {
  await processarVencidas(agora, 50, { oportunidadeId, sem: ["DISPARAR_WEBHOOK"] });
  depoisDaResposta(() => processarVencidas(new Date(), 20, { oportunidadeId }));
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
  if (agendadas > 0) await processarDaOportunidade(op.id, agora);
  return { agendadas };
}

/** Eventos que uma mudança de etapa gera. */
export const gatilhosDaMudanca = (paraTipo: string): Gatilho[] => ["OPORTUNIDADE_MOVIDA", ...(paraTipo === "GANHA" ? ["OPORTUNIDADE_GANHA" as const] : paraTipo === "PERDIDA" ? ["OPORTUNIDADE_PERDIDA" as const] : [])];

// ── Entrega ─────────────────────────────────────────────────────────────────

type EntregaCarregada = NonNullable<Awaited<ReturnType<typeof carregarEntrega>>>;
type CartaoCarregado = EntregaCarregada["cartoes"][number];

function carregarEntrega(entregaId: string) {
  return prisma.entrega.findUnique({ where: { id: entregaId }, include: { oportunidade: true, cartoes: { select: CAMPOS_CARTAO } } });
}

function contextoEntrega(e: EntregaCarregada, cartao: CartaoCarregado | null, agora: Date): ContextoOportunidade {
  return contextoDaEntrega(contextoDaOportunidade(e.oportunidade, agora), e, cartao, agora);
}

/**
 * Condição própria de cada gatilho de entrega (além dos critérios escritos na automação). Vale na varredura e,
 * depois de uma espera, para conferir se o fato ainda é verdade (ex.: o cartão continua atrasado).
 */
function fatoVale(gatilho: string, e: EntregaCarregada, ctx: ContextoOportunidade): boolean {
  if (gatilho === "ENTREGA_RENOVACAO_PROXIMA") return (e.status === "EM_ANDAMENTO" || e.status === "CONCLUIDA") && ctx.diasParaRenovar !== undefined;
  if (e.status !== "EM_ANDAMENTO") return false;
  if (gatilho === "ENTREGA_CARTAO_ATRASADO") return (ctx.diasDeAtraso ?? 0) > 0;
  if (gatilho === "ENTREGA_AGUARDANDO_CLIENTE") return (ctx.diasAguardandoCliente ?? 0) > 0;
  if (gatilho === "ENTREGA_EM_RISCO") return (ctx.notaSaude ?? 100) < 50;
  return true;
}

/** Quantos dias o texto da ação mostra em {dias}. */
function diasDoGatilho(gatilho: string, ctx: ContextoOportunidade): number | undefined {
  if (gatilho === "ENTREGA_CARTAO_ATRASADO") return ctx.diasDeAtraso;
  if (gatilho === "ENTREGA_AGUARDANDO_CLIENTE") return ctx.diasAguardandoCliente;
  if (gatilho === "ENTREGA_RENOVACAO_PROXIMA") return ctx.diasParaRenovar;
  return undefined;
}

/** Evento da entrega (cartão concluído, entrega concluída). */
export async function dispararEventoEntrega(gatilho: "ENTREGA_CARTAO_CONCLUIDO" | "ENTREGA_CONCLUIDA", entregaId: string, cartaoId: string | null, agora: Date = new Date()): Promise<{ agendadas: number }> {
  const automacoes = await prisma.automacao.findMany({ where: { ativo: true, gatilho } });
  if (automacoes.length === 0) return { agendadas: 0 };
  const e = await carregarEntrega(entregaId);
  if (!e) return { agendadas: 0 };
  const cartao = cartaoId ? e.cartoes.find((c) => c.id === cartaoId) ?? null : null;
  if (gatilho === "ENTREGA_CARTAO_CONCLUIDO" && !cartao?.concluidoEm) return { agendadas: 0 };
  if (gatilho === "ENTREGA_CONCLUIDA" && !e.concluidaEm) return { agendadas: 0 };
  const ctx = contextoEntrega(e, cartao, agora);
  // Concluir, reabrir e concluir de novo é outro fato (outra data de conclusão).
  const marcador = gatilho === "ENTREGA_CARTAO_CONCLUIDO" ? `${cartao!.id}:${cartao!.concluidoEm!.getTime()}` : `${e.id}:${e.concluidaEm!.getTime()}`;
  let agendadas = 0;
  for (const a of automacoes) if (avaliarCriterios(a.criterios as unknown as Criterio[], ctx)) agendadas += await agendar(a, e.oportunidadeId, marcador, agora, cartao?.id ?? e.id);
  if (agendadas > 0) await processarDaOportunidade(e.oportunidadeId, agora);
  return { agendadas };
}

/** Início da semana (segunda, UTC) como número: "cliente em risco" avisa no máximo uma vez por semana. */
const semana = (d: Date) => Math.floor((d.getTime() + 3 * 86_400_000) / SEMANA);

async function varrerEntregas(automacoes: AutomacaoRegistro[], agora: Date): Promise<{ avaliadas: number; agendadas: number }> {
  if (automacoes.length === 0) return { avaliadas: 0, agendadas: 0 };
  const entregas = await prisma.entrega.findMany({
    where: { status: { in: ["EM_ANDAMENTO", "CONCLUIDA"] } },
    include: { oportunidade: true, cartoes: { select: CAMPOS_CARTAO } },
  });
  let agendadas = 0;
  for (const e of entregas) {
    for (const a of automacoes) {
      const criterios = a.criterios as unknown as Criterio[];
      if ((GATILHOS_DE_CARTAO as readonly string[]).includes(a.gatilho)) {
        for (const c of e.cartoes) {
          const ctx = contextoEntrega(e, c, agora);
          if (!fatoVale(a.gatilho, e, ctx) || !avaliarCriterios(criterios, ctx)) continue;
          // Atrasado: uma vez por prazo (mudar o prazo e atrasar de novo avisa de novo). Aguardando: uma vez por espera.
          const marcador = a.gatilho === "ENTREGA_CARTAO_ATRASADO" ? `${c.id}:${c.dataAlvo!.getTime()}` : `${c.id}:${c.colunaDesdeEm.getTime()}`;
          agendadas += await agendar(a, e.oportunidadeId, marcador, agora, c.id);
        }
        continue;
      }
      const ctx = contextoEntrega(e, null, agora);
      if (!fatoVale(a.gatilho, e, ctx) || !avaliarCriterios(criterios, ctx)) continue;
      const marcador = a.gatilho === "ENTREGA_EM_RISCO" ? `${e.id}:semana${semana(agora)}` : `${e.id}:${e.renovacaoEm!.getTime()}`;
      agendadas += await agendar(a, e.oportunidadeId, marcador, agora, e.id);
    }
  }
  return { avaliadas: entregas.length, agendadas };
}

/** Procura o que se encaixa nas automações de tempo (oportunidades e entregas). Roda uma vez por dia ou por demanda. */
export async function varrerTempo(agora: Date = new Date()): Promise<{ avaliadas: number; agendadas: number; entregasAvaliadas: number }> {
  const automacoes = await prisma.automacao.findMany({ where: { ativo: true, gatilho: { in: [...GATILHOS_DE_TEMPO] } } });
  const deEntrega = automacoes.filter((a) => ehGatilhoDeEntrega(a.gatilho));
  const deOportunidade = automacoes.filter((a) => !ehGatilhoDeEntrega(a.gatilho));
  let agendadas = 0, avaliadas = 0;
  if (deOportunidade.length > 0) {
    const ops = await prisma.oportunidade.findMany({ where: { status: "EM_ANDAMENTO" } });
    avaliadas = ops.length;
    for (const op of ops) {
      const ctx = contextoDaOportunidade(op, agora);
      for (const a of deOportunidade) {
        if (!avaliarCriterios(a.criterios as unknown as Criterio[], ctx)) continue;
        // Parada: uma vez por permanência na etapa. Sem interação: uma vez por período sem atividade.
        const marcador = String(a.gatilho === "OPORTUNIDADE_ESTAGNADA" ? op.etapaDesdeEm.getTime() : op.ultimaAtividadeEm.getTime());
        agendadas += await agendar(a, op.id, marcador, agora);
      }
    }
  }
  const ent = await varrerEntregas(deEntrega, agora);
  return { avaliadas, agendadas: agendadas + ent.agendadas, entregasAvaliadas: ent.avaliadas };
}

// ── Execução ────────────────────────────────────────────────────────────────

/** Executa as ações que já venceram. Cada linha é reivindicada antes (execuções simultâneas não duplicam). */
export interface FiltroExecucao { /** só linhas desta oportunidade */ oportunidadeId?: string; /** tipos de ação a deixar para depois */ sem?: string[] }

/** Gatilhos de evento: o fato já aconteceu, a espera não o desfaz (não há o que reconferir). */
const SEM_RECONFERIR: readonly string[] = ["OPORTUNIDADE_GANHA", "OPORTUNIDADE_PERDIDA", "ENTREGA_CARTAO_CONCLUIDO", "ENTREGA_CONCLUIDA"];

export async function processarVencidas(agora: Date = new Date(), limite = 50, filtro: FiltroExecucao = {}): Promise<{ executadas: number; ignoradas: number; erros: number }> {
  // Linha reivindicada há mais de 10 min e nunca concluída = processo caiu no meio: volta para a fila.
  await prisma.automacaoExecucao.updateMany({ where: { status: "EXECUTANDO", executarEm: { lt: new Date(agora.getTime() - 10 * 60_000) } }, data: { status: "PENDENTE" } });
  const res = { executadas: 0, ignoradas: 0, erros: 0 };
  const devidas = await prisma.automacaoExecucao.findMany({
    where: { status: "PENDENTE", executarEm: { lte: agora }, ...(filtro.oportunidadeId ? { oportunidadeId: filtro.oportunidadeId } : {}), ...(filtro.sem?.length ? { acaoTipo: { notIn: filtro.sem } } : {}) },
    orderBy: { executarEm: "asc" }, take: limite,
  });
  for (const e of devidas) {
    const claim = await prisma.automacaoExecucao.updateMany({ where: { id: e.id, status: "PENDENTE" }, data: { status: "EXECUTANDO", executarEm: agora } });
    if (claim.count === 0) continue;
    const finalizar = (status: "EXECUTADA" | "IGNORADA" | "ERRO", detalhe: string) =>
      prisma.automacaoExecucao.update({ where: { id: e.id }, data: { status, detalhe: detalhe.slice(0, 500), executadaEm: new Date() } });
    const ignorar = async (motivo: string) => { await finalizar("IGNORADA", motivo); res.ignoradas++; };
    try {
      const a = await prisma.automacao.findUnique({ where: { id: e.automacaoId } });
      const op = e.oportunidadeId ? await prisma.oportunidade.findUnique({ where: { id: e.oportunidadeId }, include: INCLUIR_OPORTUNIDADE }) : null;
      if (!a || !a.ativo) { await ignorar("Automação desativada ou removida"); continue; }
      if (!op) { await ignorar("Oportunidade não existe mais"); continue; }
      const acao = (a.acoes as unknown as Acao[])[e.indice];
      if (!acao) { await ignorar("Ação não existe mais na automação"); continue; }
      const criterios = a.criterios as unknown as Criterio[];
      const reconferir = (acao.esperaHoras ?? 0) > 0 && !SEM_RECONFERIR.includes(a.gatilho);

      let ctxAcao: ContextoDaAcao = {};
      if ((GATILHOS_DE_ENTREGA as readonly string[]).includes(a.gatilho)) {
        // A referência é o cartão (gatilhos de cartão) ou a própria entrega.
        const deCartao = (GATILHOS_DE_CARTAO as readonly string[]).includes(a.gatilho);
        const entregaId = deCartao
          ? (await prisma.entregaCartao.findUnique({ where: { id: e.referenciaId ?? "" }, select: { entregaId: true } }))?.entregaId
          : e.referenciaId ?? undefined;
        const ent = entregaId ? await carregarEntrega(entregaId) : null;
        const cartao = deCartao ? ent?.cartoes.find((c) => c.id === e.referenciaId) ?? null : null;
        if (!ent || (deCartao && !cartao)) { await ignorar(deCartao ? "Cartão não existe mais" : "Entrega não existe mais"); continue; }
        const ctx = contextoEntrega(ent, cartao, agora);
        // Ação com espera: o fato ainda é verdade? (ex.: o cartão continua aguardando o cliente)
        if (reconferir && (!fatoVale(a.gatilho, ent, ctx) || !avaliarCriterios(criterios, ctx))) { await ignorar("O fato não valia mais depois da espera"); continue; }
        ctxAcao = { entrega: { id: ent.id, nome: ent.nome }, ...(cartao && { cartao: { id: cartao.id, titulo: cartao.titulo, responsavelId: cartao.responsavelId } }), dias: diasDoGatilho(a.gatilho, ctx) };
      } else if (reconferir && !avaliarCriterios(criterios, contextoDaOportunidade(op, agora))) {
        // Ação com espera: confere de novo se a oportunidade ainda se encaixa (ex.: ainda parada na etapa).
        await ignorar("Os critérios não valiam mais depois da espera"); continue;
      }
      await finalizar("EXECUTADA", await executarAcao(acao, op, { id: a.id, nome: a.nome }, a.gatilho, agora, ctxAcao));
      res.executadas++;
    } catch (err) {
      await finalizar("ERRO", err instanceof Error ? err.message : String(err));
      res.erros++;
    }
  }
  return res;
}
