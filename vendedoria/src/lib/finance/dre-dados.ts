// Montagem da DRE a partir do banco (só leitura das tabelas de lançamentos) e
// a classificação manual das categorias. A matemática mora em ./dre.ts.

import { prisma } from "@/lib/prisma/client";
import { whereEscopo, whereEscopoReceita, type Escopo } from "./escopo";
import { mesDe, periodoAnterior, somarMeses, toISODate, type Periodo } from "./periodo";
import {
  agruparLinhas, chaveCategoria, chaveLancamento, classificar, ehGrupoDre, gerarInsights, grupoInfo, montarDre, resumoDoMes,
  type GrupoDre, type ItemClassificacao, type LinhaAgregada, type MapaClassificacao, type RelatorioDre, type TipoLancamento,
} from "./dre";

/** Mesmo critério do painel: mês inteiro usa a coluna `mes`; dia/intervalo usa a data. */
function whereTransacaoPeriodo(p: Periodo) {
  return p.tipo === "mes" && p.mes ? { mes: p.mes } : { data_transacao: { gte: p.de, lte: p.ate } };
}

const ehTipo = (t: string): t is TipoLancamento => t === "receita" || t === "despesa";

export async function carregarMapaClassificacao(): Promise<MapaClassificacao> {
  const rows = await prisma.dreClassificacaoMax.findMany();
  const m = new Map<string, GrupoDre>();
  for (const r of rows) {
    if (ehTipo(r.tipo) && ehGrupoDre(r.grupo)) m.set(`${r.tipo}|${r.categoria}`, r.grupo);
  }
  return m;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Um item por lançamento do extrato: a descrição decide a linha da DRE. */
async function linhasDoPeriodo(p: Periodo, escopo: Escopo): Promise<LinhaAgregada[]> {
  const rows = await prisma.transacao.findMany({
    where: { ...whereTransacaoPeriodo(p), ...whereEscopo(escopo) },
    select: { id: true, tipo: true, categoria: true, descricao: true, valor: true, data_transacao: true },
  });
  return rows
    .filter((r) => ehTipo(r.tipo))
    .map((r) => ({
      tipo: r.tipo as TipoLancamento,
      categoria: r.categoria,
      total: r.valor,
      quantidade: 1,
      id: r.id,
      descricao: r.descricao,
      data: iso(r.data_transacao),
    }));
}

/** Receitas previstas em aberto e contas a pagar pendentes do período (modo Projetado). */
async function previstosDoPeriodo(p: Periodo, escopo: Escopo) {
  const noPeriodo = { gte: p.de, lte: p.ate };
  const receitas = await prisma.receitaPrevistaMax.findMany({
    where: { AND: [whereEscopoReceita(escopo), { data_prevista: noPeriodo }, { status: { in: ["pendente", "atrasada"] } }] },
    select: { descricao: true, cliente: true, valor: true, data_prevista: true },
  });
  const contas = await prisma.contaPagarMax.findMany({
    where: { status: "pendente", data_vencimento: noPeriodo, ...whereEscopo(escopo) },
    select: { descricao: true, categoria: true, valor: true, data_vencimento: true },
  });

  // Mesma categoria que a confirmação cria no extrato ("Receita Prevista"):
  // uma classificação manual dela vale para o realizado e para o previsto.
  const linhas: LinhaAgregada[] = [
    ...receitas.map((r) => ({
      tipo: "receita" as const,
      categoria: "Receita Prevista",
      total: r.valor,
      quantidade: 1,
      previsto: true,
      descricao: r.cliente ? `${r.descricao} — ${r.cliente}` : r.descricao,
      data: iso(r.data_prevista),
    })),
    ...contas.map((c) => ({
      tipo: "despesa" as const,
      categoria: c.categoria,
      total: c.valor,
      quantidade: 1,
      previsto: true,
      descricao: c.descricao,
      data: iso(c.data_vencimento),
    })),
  ];
  const soma = (xs: Array<{ valor: number }>) => xs.reduce((acc, x) => acc + x.valor, 0);
  return { linhas, receitas: soma(receitas), receitasQtd: receitas.length, despesas: soma(contas), despesasQtd: contas.length };
}

/** 12 meses até `mesFim` (realizado) + acumulado do ano de `mesFim`. */
async function serieMensal(mesFim: string, escopo: Escopo, mapa: MapaClassificacao) {
  const meses = Array.from({ length: 12 }, (_, i) => somarMeses(mesFim, i - 11));
  const rows = await prisma.transacao.findMany({
    where: { mes: { in: meses }, ...whereEscopo(escopo) },
    select: { id: true, mes: true, tipo: true, categoria: true, descricao: true, valor: true },
  });
  const ano = Number(mesFim.slice(0, 4));
  const inicioAno = `${ano}-01`;
  const porMes = new Map<string, LinhaAgregada[]>();
  const doAno: LinhaAgregada[] = [];
  const mesesComMovimento = new Set<string>();
  for (const r of rows) {
    if (!ehTipo(r.tipo)) continue;
    const linha: LinhaAgregada = { tipo: r.tipo, categoria: r.categoria, total: r.valor, quantidade: 1, id: r.id, descricao: r.descricao };
    if (!porMes.has(r.mes)) porMes.set(r.mes, []);
    porMes.get(r.mes)!.push(linha);
    if (r.mes >= inicioAno && r.mes <= mesFim) {
      doAno.push(linha);
      mesesComMovimento.add(r.mes);
    }
  }
  const serie = meses.map((mes) => resumoDoMes(mes, montarDre(agruparLinhas(porMes.get(mes) ?? [], mapa).valores)));
  const acumulado = montarDre(agruparLinhas(doAno, mapa).valores);
  return { serie, acumuladoAno: { ano, ate: mesFim, meses: mesesComMovimento.size, dre: acumulado } };
}

/** Todas as categorias já usadas (extrato + contas a pagar) com o grupo atual de cada uma. */
export async function listarClassificacoes(mapa?: MapaClassificacao): Promise<ItemClassificacao[]> {
  const m = mapa ?? (await carregarMapaClassificacao());
  const tx = await prisma.transacao.groupBy({ by: ["tipo", "categoria"], _sum: { valor: true }, _count: { _all: true } });
  const contas = await prisma.contaPagarMax.groupBy({ by: ["categoria"], _sum: { valor: true }, _count: { _all: true } });

  const itens = new Map<string, ItemClassificacao>();
  const somar = (tipo: TipoLancamento, categoria: string, total: number, quantidade: number) => {
    const chave = chaveCategoria(categoria);
    if (!chave) return;
    const id = `${tipo}|${chave}`;
    const atual = itens.get(id);
    if (atual) {
      atual.total += total;
      atual.quantidade += quantidade;
      return;
    }
    const { grupo, origem } = classificar(tipo, categoria, m);
    itens.set(id, { tipo, categoria: categoria.trim(), chave, grupo, origem, total, quantidade });
  };
  for (const r of tx) if (ehTipo(r.tipo)) somar(r.tipo, r.categoria, r._sum.valor ?? 0, r._count._all);
  for (const c of contas) somar("despesa", c.categoria, c._sum.valor ?? 0, c._count._all);

  return Array.from(itens.values())
    .map((i) => ({ ...i, total: Math.round(i.total * 100) / 100 }))
    .sort((a, b) => (a.tipo === b.tipo ? b.total - a.total : a.tipo === "receita" ? -1 : 1));
}

/**
 * Define (ou, com grupo null, volta ao padrão) a linha da DRE de uma categoria.
 * Passa pelo livro-razão (HistoricoFinanceiro) como todo modelo financeiro.
 */
export async function definirClassificacao(tipo: TipoLancamento, categoria: string, grupo: GrupoDre | null): Promise<void> {
  const chave = chaveCategoria(categoria);
  if (!chave) throw new Error("Categoria vazia");
  if (grupo === null) {
    await prisma.dreClassificacaoMax.deleteMany({ where: { tipo, categoria: chave } });
    return;
  }
  if (grupoInfo(grupo).tipo !== tipo) throw new Error(`O grupo "${grupoInfo(grupo).label}" não é de ${tipo}`);
  await prisma.dreClassificacaoMax.upsert({
    where: { tipo_categoria: { tipo, categoria: chave } },
    create: { tipo, categoria: chave, grupo },
    update: { grupo },
  });
}

/**
 * Move UM lançamento do extrato para outra linha da DRE (ou, com grupo null,
 * devolve à regra automática). O lançamento em si não muda.
 */
export async function definirClassificacaoLancamento(id: string, grupo: GrupoDre | null): Promise<void> {
  const t = await prisma.transacao.findUnique({ where: { id }, select: { tipo: true } });
  if (!t) throw new Error("Lançamento não encontrado");
  if (!ehTipo(t.tipo)) throw new Error("Lançamento sem tipo receita/despesa");
  const chave = chaveLancamento(id);
  if (grupo === null) {
    await prisma.dreClassificacaoMax.deleteMany({ where: { tipo: t.tipo, categoria: chave } });
    return;
  }
  if (grupoInfo(grupo).tipo !== t.tipo) throw new Error(`O grupo "${grupoInfo(grupo).label}" não é de ${t.tipo}`);
  await prisma.dreClassificacaoMax.upsert({
    where: { tipo_categoria: { tipo: t.tipo, categoria: chave } },
    create: { tipo: t.tipo, categoria: chave, grupo },
    update: { grupo },
  });
}

export async function montarRelatorioDre(periodo: Periodo, escopo: Escopo, hoje: Date): Promise<RelatorioDre> {
  const mapa = await carregarMapaClassificacao();
  const anterior = periodoAnterior(periodo);
  const mesFim = periodo.mes ?? mesDe(periodo.ate);
  const mesAtual = mesDe(hoje);

  // Em lotes pequenos para não disputar o pool de conexões (Supabase free).
  const [linhasAtual, linhasAnterior] = await Promise.all([linhasDoPeriodo(periodo, escopo), linhasDoPeriodo(anterior, escopo)]);
  const [previstos, serie] = await Promise.all([previstosDoPeriodo(periodo, escopo), serieMensal(mesFim, escopo, mapa)]);
  const classificacao = await listarClassificacoes(mapa);

  const ra = agruparLinhas(linhasAtual, mapa);
  const rant = agruparLinhas(linhasAnterior, mapa);
  const atual = montarDre(ra.valores);
  const ant = montarDre(rant.valores);
  const proj = agruparLinhas([...linhasAtual, ...previstos.linhas], mapa);

  return {
    periodo: { tipo: periodo.tipo, mes: periodo.mes ?? null, de: toISODate(periodo.de), ate: toISODate(periodo.ate), label: periodo.label },
    anterior: { label: anterior.label },
    competencia: { mesAtual, ehMesAtual: periodo.tipo === "mes" && periodo.mes === mesAtual },
    escopo,
    realizado: { atual, anterior: ant, porGrupo: ra.porGrupo },
    projetado: {
      atual: montarDre(proj.valores),
      porGrupo: proj.porGrupo,
      previsto: {
        receitas: Math.round(previstos.receitas * 100) / 100,
        receitasQtd: previstos.receitasQtd,
        despesas: Math.round(previstos.despesas * 100) / 100,
        despesasQtd: previstos.despesasQtd,
      },
    },
    serie: serie.serie,
    acumuladoAno: serie.acumuladoAno,
    classificacao,
    insights: gerarInsights({ atual, anterior: ant, serie: serie.serie, rotuloAnterior: anterior.label }),
  };
}
