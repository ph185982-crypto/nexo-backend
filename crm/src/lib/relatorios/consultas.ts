// Seis relatórios fixos sobre o histórico de etapa e os motivos. Valores em reais (número).
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { Periodo } from "./periodo";

const num = (d: { toString(): string } | null | undefined) => (d ? Number(d.toString()) : 0);
const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const DIA = 86_400_000;

/** Chance de fechar por probabilidade (previsão ponderada). Sem probabilidade: 30%. */
export const PESO_PROBABILIDADE: Record<string, number> = { QUENTE: 0.8, MORNA: 0.5, FRIA: 0.2, RISCO_ALTO: 0.05 };
export const PESO_SEM_PROBABILIDADE = 0.3;

const escopoFunil = (funilId?: string | null): Prisma.OportunidadeWhereInput => (funilId ? { funilId } : {});

// ─── 1. KPIs da empresa ──────────────────────────────────────────────────────
export async function kpis(p: Periodo, funilId?: string | null) {
  const base = escopoFunil(funilId);
  const [criadas, ganhas, perdidas, abertas] = await Promise.all([
    prisma.oportunidade.findMany({ where: { ...base, criadoEm: { gte: p.de, lt: p.ate } }, select: { valorUnico: true, valorMensal: true } }),
    prisma.oportunidade.findMany({ where: { ...base, status: "GANHA", encerradaEm: { gte: p.de, lt: p.ate } }, select: { valorUnico: true, valorMensal: true, criadoEm: true, encerradaEm: true } }),
    prisma.oportunidade.findMany({ where: { ...base, status: "PERDIDA", encerradaEm: { gte: p.de, lt: p.ate } }, select: { valorUnico: true, valorMensal: true } }),
    prisma.oportunidade.findMany({ where: { ...base, status: "EM_ANDAMENTO" }, select: { valorUnico: true, valorMensal: true, probabilidade: true } }),
  ]);
  const total = (xs: Array<{ valorUnico: { toString(): string }; valorMensal: { toString(): string } }>) => xs.reduce((s, x) => s + num(x.valorUnico) + num(x.valorMensal), 0);
  const valorGanho = total(ganhas);
  const fechadas = ganhas.length + perdidas.length;
  return {
    criadas: { quantidade: criadas.length, valor: total(criadas) },
    emAndamento: { quantidade: abertas.length, valor: total(abertas) },
    ganhas: { quantidade: ganhas.length, valor: valorGanho, valorUnico: ganhas.reduce((s, x) => s + num(x.valorUnico), 0), valorMensal: ganhas.reduce((s, x) => s + num(x.valorMensal), 0) },
    perdidas: { quantidade: perdidas.length, valor: total(perdidas) },
    hitRate: fechadas ? ganhas.length / fechadas : null,
    ticketMedio: ganhas.length ? valorGanho / ganhas.length : null,
    cicloMedioDias: media(ganhas.map((g) => (g.encerradaEm!.getTime() - g.criadoEm.getTime()) / DIA)),
    previsao: {
      total: total(abertas),
      ponderada: abertas.reduce((s, o) => s + (num(o.valorUnico) + num(o.valorMensal)) * (o.probabilidade ? PESO_PROBABILIDADE[o.probabilidade] ?? PESO_SEM_PROBABILIDADE : PESO_SEM_PROBABILIDADE), 0),
    },
  };
}

// ─── 2. Funil por etapa: quantos chegaram, conversão para a próxima, tempo médio ──
// "Chegaram" é cumulativo: conta quem entrou na etapa OU foi além dela (inclusive quem foi direto
// a Ganha, pulando etapas). Por isso a conversão para a próxima etapa nunca passa de 100%.
export async function funilPorEtapa(p: Periodo, funilId: string) {
  const etapas = await prisma.etapa.findMany({ where: { funilId }, orderBy: { ordem: "asc" } });
  if (etapas.length === 0) return null;
  const historico = await prisma.historicoEtapa.findMany({
    where: { paraEtapaId: { in: etapas.map((e) => e.id) }, oportunidade: { criadoEm: { gte: p.de, lt: p.ate } } },
    select: { oportunidadeId: true, paraEtapaId: true, entrouEm: true, saiuEm: true },
  });
  const atuais = await prisma.oportunidade.groupBy({ by: ["etapaId"], where: { funilId, status: "EM_ANDAMENTO", criadoEm: { gte: p.de, lt: p.ate } }, _count: { _all: true }, _sum: { valorUnico: true, valorMensal: true } });

  const abertas = etapas.filter((e) => e.tipo === "ABERTA");
  const indiceAberta = new Map(abertas.map((e, i) => [e.id, i]));
  const ganhaId = new Set(etapas.filter((e) => e.tipo === "GANHA").map((e) => e.id));
  // Até onde cada oportunidade chegou: maior etapa aberta visitada; quem ganhou passou de todas.
  const alcance = new Map<string, number>();
  for (const h of historico) {
    const nivel = ganhaId.has(h.paraEtapaId) ? abertas.length : indiceAberta.get(h.paraEtapaId);
    if (nivel === undefined) continue;
    alcance.set(h.oportunidadeId, Math.max(alcance.get(h.oportunidadeId) ?? -1, nivel));
  }
  const chegaram = (i: number) => [...alcance.values()].filter((n) => n >= i).length;

  const linhas = etapas.map((e) => {
    const h = historico.filter((x) => x.paraEtapaId === e.id);
    const idx = indiceAberta.get(e.id);
    const entraram = idx !== undefined ? chegaram(idx) : new Set(h.map((x) => x.oportunidadeId)).size;
    const duracoes = h.filter((x) => x.saiuEm).map((x) => (x.saiuEm!.getTime() - x.entrouEm.getTime()) / DIA);
    const agora = atuais.find((a) => a.etapaId === e.id);
    return { etapaId: e.id, nome: e.nome, tipo: e.tipo, entraram, diasMedios: media(duracoes), agora: agora?._count._all ?? 0, valorAgora: num(agora?._sum.valorUnico) + num(agora?._sum.valorMensal), conversaoParaProxima: null as number | null };
  });
  const linhasAbertas = linhas.filter((l) => l.tipo === "ABERTA");
  linhasAbertas.forEach((l, i) => { const prox = linhasAbertas[i + 1]; l.conversaoParaProxima = prox && l.entraram > 0 ? prox.entraram / l.entraram : null; });
  const primeira = linhasAbertas[0]?.entraram ?? 0;
  const ganhas = linhas.filter((l) => l.tipo === "GANHA").reduce((s, l) => s + l.entraram, 0);
  return { etapas: linhas, entradas: primeira, ganhas, conversaoTotal: primeira > 0 ? ganhas / primeira : null };
}

// ─── 3. Ganhos e perdas por motivo ───────────────────────────────────────────
export async function ganhosEPerdas(p: Periodo, funilId?: string | null) {
  const ops = await prisma.oportunidade.findMany({
    where: { ...escopoFunil(funilId), status: { in: ["GANHA", "PERDIDA"] }, encerradaEm: { gte: p.de, lt: p.ate } },
    select: { status: true, valorUnico: true, valorMensal: true, motivo: { select: { nome: true } } },
  });
  const agrupar = (status: string) => {
    const mapa = new Map<string, { quantidade: number; valor: number }>();
    for (const o of ops.filter((x) => x.status === status)) {
      const k = o.motivo?.nome ?? "Sem motivo registrado";
      const a = mapa.get(k) ?? { quantidade: 0, valor: 0 };
      a.quantidade++; a.valor += num(o.valorUnico) + num(o.valorMensal);
      mapa.set(k, a);
    }
    const linhas = [...mapa.entries()].map(([motivo, v]) => ({ motivo, ...v })).sort((a, b) => b.quantidade - a.quantidade || b.valor - a.valor);
    return { total: linhas.reduce((s, l) => s + l.quantidade, 0), semMotivo: mapa.get("Sem motivo registrado")?.quantidade ?? 0, linhas };
  };
  return { ganhas: agrupar("GANHA"), perdidas: agrupar("PERDIDA") };
}

// ─── 4. Ranking da equipe ────────────────────────────────────────────────────
export async function ranking(p: Periodo, funilId?: string | null) {
  const base = escopoFunil(funilId);
  const [criadas, encerradas, usuarios] = await Promise.all([
    prisma.oportunidade.groupBy({ by: ["responsavelId"], where: { ...base, criadoEm: { gte: p.de, lt: p.ate } }, _count: { _all: true } }),
    prisma.oportunidade.findMany({ where: { ...base, status: { in: ["GANHA", "PERDIDA"] }, encerradaEm: { gte: p.de, lt: p.ate } }, select: { responsavelId: true, status: true, valorUnico: true, valorMensal: true } }),
    prisma.usuario.findMany({ select: { id: true, nome: true } }),
  ]);
  const ids = new Set<string | null>([...criadas.map((c) => c.responsavelId), ...encerradas.map((e) => e.responsavelId)]);
  const linhas = [...ids].map((id) => {
    const g = encerradas.filter((e) => e.responsavelId === id && e.status === "GANHA");
    const pe = encerradas.filter((e) => e.responsavelId === id && e.status === "PERDIDA");
    return {
      responsavelId: id, nome: id ? usuarios.find((u) => u.id === id)?.nome ?? "Usuário removido" : "Sem responsável",
      criadas: criadas.find((c) => c.responsavelId === id)?._count._all ?? 0, ganhas: g.length, perdidas: pe.length,
      valorGanho: g.reduce((s, x) => s + num(x.valorUnico) + num(x.valorMensal), 0), hitRate: g.length + pe.length ? g.length / (g.length + pe.length) : null,
    };
  });
  return linhas.sort((a, b) => b.valorGanho - a.valorGanho || b.ganhas - a.ganhas || b.criadas - a.criadas);
}

// ─── 5. Metas × realizado ────────────────────────────────────────────────────
export const TIPOS_META = ["TOTAL", "UNICO", "MENSAL"] as const;
export type TipoMeta = (typeof TIPOS_META)[number];
const BRT = 3 * 3_600_000;

export async function metasDoAno(ano: number, escopo: string, tipo: TipoMeta) {
  const inicio = new Date(Date.UTC(ano, 0, 1) + BRT), fim = new Date(Date.UTC(ano + 1, 0, 1) + BRT);
  const [metas, ganhas] = await Promise.all([
    prisma.meta.findMany({ where: { ano, escopo, tipo } }),
    prisma.oportunidade.findMany({ where: { ...(escopo === "TODOS" ? {} : { funilId: escopo }), status: "GANHA", encerradaEm: { gte: inicio, lt: fim } }, select: { encerradaEm: true, valorUnico: true, valorMensal: true } }),
  ]);
  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const realizado = ganhas.filter((g) => new Date(g.encerradaEm!.getTime() - BRT).getUTCMonth() === i).reduce((s, g) => s + (tipo === "UNICO" ? num(g.valorUnico) : tipo === "MENSAL" ? num(g.valorMensal) : num(g.valorUnico) + num(g.valorMensal)), 0);
    const meta = num(metas.find((m) => m.mes === mes)?.valor);
    // Meta zero ou ausente = SEM META. Nunca vira 100%.
    return { mes, meta: meta > 0 ? meta : null, realizado, atingimento: meta > 0 ? realizado / meta : null };
  });
}

export async function definirMeta(m: { escopo: string; ano: number; mes: number; tipo: TipoMeta; valor: number }) {
  const where = { escopo_ano_mes_tipo: { escopo: m.escopo, ano: m.ano, mes: m.mes, tipo: m.tipo } };
  if (m.valor <= 0) { await prisma.meta.deleteMany({ where: { escopo: m.escopo, ano: m.ano, mes: m.mes, tipo: m.tipo } }); return null; }
  return prisma.meta.upsert({ where, update: { valor: m.valor }, create: m });
}

// ─── 6. Auditoria das movimentações ──────────────────────────────────────────
export async function auditoria(p: Periodo, o: { funilId?: string | null; origem?: string | null; limite?: number } = {}) {
  const linhas = await prisma.historicoEtapa.findMany({
    where: { entrouEm: { gte: p.de, lt: p.ate }, ...(o.origem ? { origem: o.origem } : {}), ...(o.funilId ? { oportunidade: { funilId: o.funilId } } : {}) },
    orderBy: { entrouEm: "desc" }, take: Math.min(o.limite ?? 200, 500),
    include: { oportunidade: { select: { nome: true } } },
  });
  const usuarios = await prisma.usuario.findMany({ where: { id: { in: [...new Set(linhas.map((l) => l.ator).filter((a): a is string => !!a))] } }, select: { id: true, nome: true } });
  const nomeDoAtor = (a: string | null) => (!a ? "—" : a === "vendedor-ia" ? "Vendedor IA" : a === "automacao" ? "Automação" : usuarios.find((u) => u.id === a)?.nome ?? a);
  return linhas.map((l) => ({
    id: l.id, quando: l.entrouEm, oportunidade: l.oportunidade.nome, de: l.deEtapaNome ? `${l.deFunilNome} · ${l.deEtapaNome}` : null, para: `${l.paraFunilNome} · ${l.paraEtapaNome}`,
    origem: l.origem, ator: nomeDoAtor(l.ator), motivo: l.motivo,
  }));
}
