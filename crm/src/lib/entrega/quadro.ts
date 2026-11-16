// Leituras do funil de entrega para quadro, renovações, histórico do cartão e gatilhos.
// Usadas pela API de serviço da Central; reaproveitam constantes e saúde do CRM.
import { prisma } from "@/lib/prisma";
import { ehGatilhoDeEntrega, GATILHOS_DE_ENTREGA, ROTULO_GATILHO, type Gatilho } from "@/lib/automacao/modelo";
import { normalizarChecklist } from "@/lib/atividades/tarefas";
import { COLUNAS, PILARES, ROTULO_COLUNA, ROTULO_PILAR, STATUS_ENTREGA } from "./constantes";
import { calcularSaudeEntrega, DIAS_ALERTA_RENOVACAO } from "./saude";

const DIA = 86_400_000;
const num = (d: { toString(): string }) => Number(d.toString());
const dias = (de: Date, ate: Date) => Math.floor((ate.getTime() - de.getTime()) / DIA);

export interface FiltroQuadro { status?: string | null; entregaId?: string | null; contatoId?: string | null; q?: string | null; responsavelId?: string | null; pilar?: string | null; atrasados?: boolean }

export interface CartaoQuadro {
  id: string; entregaId: string; titulo: string; pilar: string; coluna: string; ordem: number; dataAlvo: Date | null; cliente: boolean;
  responsavel: { id: string; nome: string } | null; diasDeAtraso: number; diasNaColuna: number; concluidoEm: Date | null; checklist: { feitos: number; total: number };
}

export async function quadroEntregas(f: FiltroQuadro = {}, agora: Date = new Date()) {
  const q = f.q?.trim();
  const status = f.status && (STATUS_ENTREGA as readonly string[]).includes(f.status) ? f.status : "EM_ANDAMENTO";
  const entregas = await prisma.entrega.findMany({
    where: {
      status,
      ...(f.entregaId && { id: f.entregaId }),
      ...(f.contatoId && { contatoId: f.contatoId }),
      ...(q && { OR: [{ nome: { contains: q, mode: "insensitive" as const } }, { contato: { nome: { contains: q, mode: "insensitive" as const } } }] }),
    },
    orderBy: [{ renovacaoEm: { sort: "asc", nulls: "last" } }, { criadoEm: "desc" }], take: 200,
    include: {
      contato: { select: { id: true, nome: true } },
      cartoes: { orderBy: [{ coluna: "asc" }, { ordem: "asc" }], include: { responsavel: { select: { id: true, nome: true } } } },
    },
  });

  const cartoes: CartaoQuadro[] = [];
  const lista = entregas.map((e) => {
    const saude = calcularSaudeEntrega(e.cartoes, e.renovacaoEm, agora);
    for (const c of e.cartoes) {
      if (f.pilar && c.pilar !== f.pilar) continue;
      if (f.responsavelId && (f.responsavelId === "sem" ? c.responsavelId !== null : c.responsavelId !== f.responsavelId)) continue;
      const diasDeAtraso = c.coluna !== "CONCLUIDO" && c.dataAlvo && c.dataAlvo.getTime() < agora.getTime() ? Math.max(1, dias(c.dataAlvo, agora)) : 0;
      if (f.atrasados && !diasDeAtraso) continue;
      const checklist = normalizarChecklist(c.checklist);
      cartoes.push({
        id: c.id, entregaId: e.id, titulo: c.titulo, pilar: c.pilar, coluna: c.coluna, ordem: c.ordem, dataAlvo: c.dataAlvo, cliente: c.cliente,
        responsavel: c.responsavel, diasDeAtraso, diasNaColuna: Math.max(0, dias(c.colunaDesdeEm, agora)), concluidoEm: c.concluidoEm,
        checklist: { feitos: checklist.filter((i) => i.feito).length, total: checklist.length },
      });
    }
    return {
      id: e.id, nome: e.nome, status: e.status, contato: e.contato, inicioEm: e.inicioEm, fimPrevistoEm: e.fimPrevistoEm, renovacaoEm: e.renovacaoEm,
      valorMensal: num(e.valorMensal), oportunidadeId: e.oportunidadeId, renovacaoOportunidadeId: e.renovacaoOportunidadeId?.startsWith("reservando:") ? null : e.renovacaoOportunidadeId, saude,
    };
  });
  // Com filtro de pilar/responsável/atraso, entregas sem nenhum cartão correspondente saem do quadro.
  const filtraCartao = Boolean(f.pilar || f.responsavelId || f.atrasados);
  const comCartao = new Set(cartoes.map((c) => c.entregaId));
  const entregasFiltradas = filtraCartao ? lista.filter((e) => comCartao.has(e.id)) : lista;

  return {
    colunas: COLUNAS.map((k) => ({ id: k, rotulo: ROTULO_COLUNA[k] })),
    pilares: PILARES.map((k) => ({ id: k, rotulo: ROTULO_PILAR[k] })),
    indicadores: {
      entregas: entregasFiltradas.length,
      mrr: entregasFiltradas.reduce((s, e) => s + e.valorMensal, 0),
      cartoesAbertos: cartoes.filter((c) => c.coluna !== "CONCLUIDO").length,
      atrasados: cartoes.filter((c) => c.diasDeAtraso > 0).length,
      aguardandoCliente: cartoes.filter((c) => c.coluna === "AGUARDANDO_CLIENTE").length,
      emRisco: entregasFiltradas.filter((e) => e.saude.rotulo === "EM_RISCO").length,
      renovacoesProximas: entregasFiltradas.filter((e) => e.saude.renovacaoProxima).length,
    },
    entregas: entregasFiltradas,
    cartoes,
  };
}

/** Entregas com renovação nos próximos `diasAdiante` dias (inclui as já vencidas), da mais próxima para a mais distante. */
export async function renovacoesProximas(diasAdiante: number = DIAS_ALERTA_RENOVACAO, agora: Date = new Date()) {
  const lim = new Date(agora.getTime() + diasAdiante * DIA);
  const es = await prisma.entrega.findMany({
    where: { status: { in: ["EM_ANDAMENTO", "CONCLUIDA"] }, renovacaoEm: { not: null, lte: lim } },
    orderBy: { renovacaoEm: "asc" }, take: 200,
    include: { contato: { select: { id: true, nome: true } } },
  });
  return es.map((e) => ({
    entregaId: e.id, nome: e.nome, contato: e.contato, renovacaoEm: e.renovacaoEm!, diasParaRenovar: Math.ceil((e.renovacaoEm!.getTime() - agora.getTime()) / DIA),
    valorMensal: num(e.valorMensal), status: e.status,
    // "reservando:…" é a reserva interna da rotina enquanto cria a oportunidade; não é um id.
    renovacaoOportunidadeId: e.renovacaoOportunidadeId?.startsWith("reservando:") ? null : e.renovacaoOportunidadeId,
  }));
}

/** Cartão aberto com a linha do tempo derivada dos próprios campos, combinados ligados e execuções de automação. */
export async function detalheCartao(entregaId: string, cartaoId: string) {
  const c = await prisma.entregaCartao.findFirst({
    where: { id: cartaoId, entregaId },
    include: { responsavel: { select: { id: true, nome: true } }, entrega: { select: { id: true, nome: true, status: true, renovacaoEm: true, contato: { select: { id: true, nome: true } } } } },
  });
  if (!c) return null;
  const [combinados, execucoes] = await Promise.all([
    prisma.combinado.findMany({ where: { cartaoId }, orderBy: { criadoEm: "asc" }, select: { id: true, descricao: true, status: true, prazoEm: true, entregueEm: true, criadoEm: true } }),
    prisma.automacaoExecucao.findMany({ where: { referenciaId: cartaoId }, orderBy: { criadoEm: "asc" }, take: 30, select: { id: true, gatilho: true, acaoTipo: true, status: true, executadaEm: true, criadoEm: true } }),
  ]);
  const historico: Array<{ em: Date; tipo: string; texto: string }> = [{ em: c.criadoEm, tipo: "CRIADO", texto: "Cartão criado" }];
  if (c.planejadoEm) historico.push({ em: c.planejadoEm, tipo: "PLANEJADO", texto: "Coluna definida pela rotina ou por uma pessoa" });
  if (c.colunaDesdeEm.getTime() !== c.criadoEm.getTime()) historico.push({ em: c.colunaDesdeEm, tipo: "COLUNA", texto: `Entrou em "${ROTULO_COLUNA[c.coluna as keyof typeof ROTULO_COLUNA] ?? c.coluna}"` });
  if (c.concluidoEm) historico.push({ em: c.concluidoEm, tipo: "CONCLUIDO", texto: "Cartão concluído" });
  for (const x of combinados) historico.push({ em: x.criadoEm, tipo: "COMBINADO", texto: `Combinado (${x.status.toLowerCase()}): ${x.descricao}`.slice(0, 300) });
  for (const x of execucoes) historico.push({ em: x.executadaEm ?? x.criadoEm, tipo: "AUTOMACAO", texto: `Automação ${ehGatilhoDeEntrega(x.gatilho) ? ROTULO_GATILHO[x.gatilho as Gatilho] : x.gatilho}: ${x.acaoTipo} (${x.status.toLowerCase()})` });
  historico.sort((a, b) => a.em.getTime() - b.em.getTime());
  const { entrega, responsavel, checklist, ...resto } = c;
  return { ...resto, checklist: normalizarChecklist(checklist), responsavel, entrega, combinados, historico };
}

/** Automações ligadas a gatilhos de entrega, com o balanço das execuções dos últimos 30 dias. */
export async function gatilhosDeEntrega(agora: Date = new Date()) {
  const desde = new Date(agora.getTime() - 30 * DIA);
  const automacoes = await prisma.automacao.findMany({ where: { gatilho: { in: [...GATILHOS_DE_ENTREGA] } }, orderBy: [{ ativo: "desc" }, { nome: "asc" }], select: { id: true, nome: true, ativo: true, gatilho: true } });
  const exec = await prisma.automacaoExecucao.groupBy({ by: ["automacaoId", "status"], where: { automacaoId: { in: automacoes.map((a) => a.id) }, criadoEm: { gte: desde } }, _count: { _all: true } });
  return {
    gatilhos: GATILHOS_DE_ENTREGA.map((g) => ({ id: g, rotulo: ROTULO_GATILHO[g] })),
    automacoes: automacoes.map((a) => ({
      ...a, rotuloGatilho: ROTULO_GATILHO[a.gatilho as Gatilho] ?? a.gatilho,
      execucoes30d: Object.fromEntries(exec.filter((x) => x.automacaoId === a.id).map((x) => [x.status, x._count._all])),
    })),
  };
}

export const listarResponsaveis = () => prisma.usuario.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } });
