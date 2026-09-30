// GET /api/financeiro/overview
//   ?mes=YYYY-MM | ?dia=YYYY-MM-DD | ?de=YYYY-MM-DD&ate=YYYY-MM-DD   (padrão: mês corrente)
//   &escopo=todos|nexo|pessoal                                       (padrão: todos)
//
// O painel é de COMPETÊNCIA MENSAL: sem parâmetros mostra só o mês corrente
// (data de Brasília — na virada do dia 1º passa sozinho para o mês novo) e
// compara com o mês anterior. Tudo que ficou para trás não some: receitas em
// aberto de meses passados aparecem à parte como "em atraso".

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";
import { migrarVendedoriaParaNexo } from "@/lib/finance/migrate-tipo-negocio";
import { garantirParcelasContratos } from "@/lib/finance/contratos";
import { carimbarHistoricoInicial } from "@/lib/finance/historico-inicial";
import { getBrasiliaDateOnly } from "@/lib/max/config";
import { blocoDoNegocio, parseEscopo, whereEscopo, whereEscopoReceita, type Escopo } from "@/lib/finance/escopo";
import {
  mesDe, periodoAnterior, resolverPeriodo, somarMeses, toISODate, type Periodo,
} from "@/lib/finance/periodo";

// O carimbo inicial do histórico (uma única vez) pode ler/gravar milhares de linhas.
export const maxDuration = 30;

type Bloco = "nexo" | "pessoal" | "outros";
const BLOCOS: Bloco[] = ["nexo", "pessoal", "outros"];

const arred = (n: number) => Math.round(n * 100) / 100;

function variacaoPct(atual: number, anterior: number): number | null {
  if (anterior === 0) return atual === 0 ? 0 : null; // null = "sem base de comparação"
  return Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10;
}

/** Filtro de Transacao para o período. Em mês inteiro usa `mes` (mesmo critério de sempre). */
function whereTransacao(p: Periodo) {
  return p.tipo === "mes" && p.mes ? { mes: p.mes } : { data_transacao: { gte: p.de, lte: p.ate } };
}

interface SomaBloco { receitas: number; despesas: number }
type SomasPorBloco = Record<Bloco, SomaBloco>;

async function somasPorBloco(p: Periodo): Promise<SomasPorBloco> {
  const rows = await prisma.transacao.groupBy({
    by: ["tipo_negocio", "tipo"],
    where: whereTransacao(p),
    _sum: { valor: true },
  });
  const out: SomasPorBloco = { nexo: { receitas: 0, despesas: 0 }, pessoal: { receitas: 0, despesas: 0 }, outros: { receitas: 0, despesas: 0 } };
  for (const r of rows) {
    const b = blocoDoNegocio(r.tipo_negocio);
    if (r.tipo === "receita") out[b].receitas += r._sum.valor ?? 0;
    else if (r.tipo === "despesa") out[b].despesas += r._sum.valor ?? 0;
  }
  return out;
}

function totalDoEscopo(s: SomasPorBloco, escopo: Escopo): SomaBloco {
  const blocos: Bloco[] = escopo === "todos" ? BLOCOS : [escopo];
  return {
    receitas: blocos.reduce((a, b) => a + s[b].receitas, 0),
    despesas: blocos.reduce((a, b) => a + s[b].despesas, 0),
  };
}

const proximaResumo = (r: { id: string; descricao: string; valor: number; data_prevista: Date; cliente: string | null; status: string; tipo_negocio: string | null; parcela_numero: number | null; parcelas_total: number | null }, hoje: Date) => ({
  id: r.id,
  descricao: r.descricao,
  valor: r.valor,
  data_prevista: r.data_prevista,
  cliente: r.cliente,
  status: r.status,
  tipo_negocio: r.tipo_negocio,
  parcela_numero: r.parcela_numero,
  parcelas_total: r.parcelas_total,
  atrasada: r.status === "atrasada" || (r.status === "pendente" && r.data_prevista < hoje),
});

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await migrarVendedoriaParaNexo();
    await carimbarHistoricoInicial().catch((e) => console.error("[financeiro] carimbo inicial do histórico falhou:", e));
    await garantirParcelasContratos();

    const sp = req.nextUrl.searchParams;
    const hoje = getBrasiliaDateOnly();
    const mesAtual = mesDe(hoje);
    const periodo = resolverPeriodo(
      { mes: sp.get("mes"), dia: sp.get("dia"), de: sp.get("de"), ate: sp.get("ate") },
      hoje,
    );
    const anterior = periodoAnterior(periodo);
    const escopo = parseEscopo(sp.get("escopo"));

    // ── Entradas/saídas efetivas (extrato) ─────────────────────────────────
    const [atualPorBloco, anteriorPorBloco] = await Promise.all([somasPorBloco(periodo), somasPorBloco(anterior)]);
    const atual = totalDoEscopo(atualPorBloco, escopo);
    const ant = totalDoEscopo(anteriorPorBloco, escopo);
    const receitas = arred(atual.receitas);
    const despesas = arred(atual.despesas);
    const saldo = arred(receitas - despesas);
    const saldoAnt = arred(ant.receitas - ant.despesas);

    const comparativo = {
      periodoAnterior: { tipo: anterior.tipo, mes: anterior.mes ?? null, label: anterior.label },
      mesAnterior: anterior.mes ?? null, // compatibilidade com a versão anterior da tela
      receitas: { atual: receitas, anterior: arred(ant.receitas), variacaoPct: variacaoPct(receitas, ant.receitas) },
      despesas: { atual: despesas, anterior: arred(ant.despesas), variacaoPct: variacaoPct(despesas, ant.despesas) },
      saldo: { atual: saldo, anterior: saldoAnt, variacaoPct: variacaoPct(saldo, saldoAnt) },
    };

    // ── Divisão Nexo × Pessoal (sempre os dois blocos, independente do filtro) ──
    // Receitas previstas do período agrupadas por negócio/status
    const previstasRows = await prisma.receitaPrevistaMax.groupBy({
      by: ["tipo_negocio", "status"],
      where: { data_prevista: { gte: periodo.de, lte: periodo.ate } },
      _sum: { valor: true },
      _count: { _all: true },
    });
    const previstoPorBloco: Record<Bloco, { abertas: number; recebidas: number; perdidas: number }> = {
      nexo: { abertas: 0, recebidas: 0, perdidas: 0 },
      pessoal: { abertas: 0, recebidas: 0, perdidas: 0 },
      outros: { abertas: 0, recebidas: 0, perdidas: 0 },
    };
    for (const r of previstasRows) {
      const b = blocoDoNegocio(r.tipo_negocio);
      const v = r._sum.valor ?? 0;
      if (r.status === "recebida") previstoPorBloco[b].recebidas += v;
      else if (r.status === "perdida") previstoPorBloco[b].perdidas += v;
      else previstoPorBloco[b].abertas += v;
    }

    const porNegocio = Object.fromEntries(
      BLOCOS.map((b) => {
        const a = atualPorBloco[b];
        const p = anteriorPorBloco[b];
        return [
          b,
          {
            receitas: arred(a.receitas),
            despesas: arred(a.despesas),
            saldo: arred(a.receitas - a.despesas),
            anterior: { receitas: arred(p.receitas), despesas: arred(p.despesas), saldo: arred(p.receitas - p.despesas) },
            variacao: {
              receitas: variacaoPct(a.receitas, p.receitas),
              despesas: variacaoPct(a.despesas, p.despesas),
              saldo: variacaoPct(a.receitas - a.despesas, p.receitas - p.despesas),
            },
            previsto: {
              abertas: arred(previstoPorBloco[b].abertas),
              recebidas: arred(previstoPorBloco[b].recebidas),
              perdidas: arred(previstoPorBloco[b].perdidas),
            },
          },
        ];
      }),
    );

    // ── Receitas previstas (lista do escopo) ─────────────────────────────────
    const escopoReceita = whereEscopoReceita(escopo);
    const noPeriodo = { data_prevista: { gte: periodo.de, lte: periodo.ate } };
    const abertas = { status: { in: ["pendente", "atrasada"] } };

    const [prevAgg, prevLista, atrasadasAgg, atrasadasLista, perdidasAgg, perdidasLista, recebidasAgg] = await Promise.all([
      prisma.receitaPrevistaMax.aggregate({ where: { AND: [escopoReceita, noPeriodo, abertas] }, _sum: { valor: true }, _count: true }),
      prisma.receitaPrevistaMax.findMany({ where: { AND: [escopoReceita, noPeriodo, abertas] }, orderBy: { data_prevista: "asc" }, take: 100 }),
      prisma.receitaPrevistaMax.aggregate({ where: { AND: [escopoReceita, { data_prevista: { lt: periodo.de } }, abertas] }, _sum: { valor: true }, _count: true }),
      prisma.receitaPrevistaMax.findMany({ where: { AND: [escopoReceita, { data_prevista: { lt: periodo.de } }, abertas] }, orderBy: { data_prevista: "asc" }, take: 20 }),
      prisma.receitaPrevistaMax.aggregate({ where: { AND: [escopoReceita, noPeriodo, { status: "perdida" }] }, _sum: { valor: true }, _count: true }),
      prisma.receitaPrevistaMax.findMany({ where: { AND: [escopoReceita, noPeriodo, { status: "perdida" }] }, orderBy: { data_prevista: "asc" }, take: 20 }),
      prisma.receitaPrevistaMax.aggregate({ where: { AND: [escopoReceita, noPeriodo, { status: "recebida" }] }, _sum: { valor: true }, _count: true }),
    ]);

    const receitasPrevistas = {
      total: arred(prevAgg._sum.valor ?? 0),
      quantidade: prevAgg._count,
      recebido: arred(recebidasAgg._sum.valor ?? 0),
      recebidoQuantidade: recebidasAgg._count,
      // compatibilidade com a versão anterior da tela
      proximas: prevLista.slice(0, 5).map((r) => proximaResumo(r, hoje)),
      itens: prevLista.map((r) => proximaResumo(r, hoje)),
      atrasadasAnteriores: {
        total: arred(atrasadasAgg._sum.valor ?? 0),
        quantidade: atrasadasAgg._count,
        itens: atrasadasLista.map((r) => proximaResumo(r, hoje)),
      },
      perdidas: {
        total: arred(perdidasAgg._sum.valor ?? 0),
        quantidade: perdidasAgg._count,
        itens: perdidasLista.map((r) => ({ ...proximaResumo(r, hoje), motivo_perda: r.motivo_perda })),
      },
    };

    // ── Meta (só faz sentido em visão mensal) ────────────────────────────────
    let meta: { alvo: number; atual: number } | null = null;
    if (periodo.tipo === "mes") {
      const candidatas = await prisma.metaFinanceiraMax.findMany({
        where: { tipo: "mensal", status: "ativa" },
        orderBy: { criado_em: "desc" },
      });
      const metaDb =
        escopo === "todos"
          ? (candidatas.find((m) => !m.tipo_negocio) ?? candidatas[0])
          : candidatas.find((m) => m.tipo_negocio === escopo);
      const alvo = metaDb?.valor_alvo ?? (escopo === "todos" ? 8000 : null);
      if (alvo != null) meta = { alvo, atual: receitas };
    }

    // ── Despesas por categoria (escopo + período) ────────────────────────────
    const categoriasRaw = await prisma.transacao.groupBy({
      by: ["categoria"],
      where: { tipo: "despesa", ...whereTransacao(periodo), ...whereEscopo(escopo) },
      _sum: { valor: true },
      orderBy: { _sum: { valor: "desc" } },
      take: 8,
    });
    const categorias = categoriasRaw.map((c) => ({ categoria: c.categoria, total: arred(c._sum.valor ?? 0) }));

    // ── Últimos 6 meses até o mês do período (escopo aplicado) ────────────────
    const mesFim = periodo.mes ?? mesDe(periodo.ate);
    const meses = Array.from({ length: 6 }, (_, i) => somarMeses(mesFim, i - 5));
    const mensalRows = await prisma.transacao.groupBy({
      by: ["mes", "tipo", "tipo_negocio"],
      where: { mes: { in: meses } },
      _sum: { valor: true },
    });
    const mensal = meses.map((mes) => {
      let rec = 0;
      let desp = 0;
      for (const r of mensalRows) {
        if (r.mes !== mes) continue;
        if (escopo !== "todos" && blocoDoNegocio(r.tipo_negocio) !== escopo) continue;
        if (r.tipo === "receita") rec += r._sum.valor ?? 0;
        else if (r.tipo === "despesa") desp += r._sum.valor ?? 0;
      }
      return { mes, receitas: arred(rec), despesas: arred(desp) };
    });

    return NextResponse.json({
      periodo: { tipo: periodo.tipo, mes: periodo.mes ?? null, de: toISODate(periodo.de), ate: toISODate(periodo.ate), label: periodo.label },
      competencia: { mesAtual, hoje: toISODate(hoje), ehMesAtual: periodo.tipo === "mes" && periodo.mes === mesAtual },
      escopo,
      receitas,
      despesas,
      saldo,
      meta,
      categorias,
      mensal,
      comparativo,
      porNegocio,
      receitasPrevistas,
    });
  } catch (err) {
    console.error("[financeiro/overview]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
