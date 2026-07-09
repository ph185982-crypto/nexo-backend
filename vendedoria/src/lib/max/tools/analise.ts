import { prisma } from "@/lib/prisma/client";
import { getBrasiliaNow, formatMes, MAX_DEEP_MODEL } from "../config";
import { chatCompletion } from "../openai";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function fmtDate(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

// ---------------------------------------------------------------------------
// analise_profunda
// ---------------------------------------------------------------------------
export async function analiseProfunda(args: Record<string, unknown>): Promise<string> {
  const pergunta = args.pergunta as string;
  const now = getBrasiliaNow();
  const d90ago = new Date(now);
  d90ago.setDate(d90ago.getDate() - 90);

  // Gather financial context in parallel
  const [transacoes, dividas, metas, receitasPrevistas, contasPagar] =
    await Promise.all([
      prisma.transacao.findMany({
        where: { data_transacao: { gte: d90ago } },
        orderBy: { data_transacao: "desc" },
      }),
      prisma.dividaMax.findMany({ where: { status: "ativa" } }),
      prisma.metaFinanceiraMax.findMany({
        where: { status: { not: "cancelada" } },
      }),
      prisma.receitaPrevistaMax.findMany({
        where: { status: { in: ["pendente", "atrasada"] } },
      }),
      prisma.contaPagarMax.findMany({
        where: { status: "pendente" },
      }),
    ]);

  // Build context text
  let totalReceitas = 0;
  let totalDespesas = 0;
  const porCategoria: Record<string, number> = {};
  const porMes: Record<string, { receitas: number; despesas: number }> = {};

  for (const tx of transacoes) {
    if (tx.tipo === "receita") totalReceitas += tx.valor;
    else totalDespesas += tx.valor;

    if (tx.tipo === "despesa") {
      porCategoria[tx.categoria] = (porCategoria[tx.categoria] ?? 0) + tx.valor;
    }

    if (!porMes[tx.mes]) porMes[tx.mes] = { receitas: 0, despesas: 0 };
    if (tx.tipo === "receita") porMes[tx.mes].receitas += tx.valor;
    else porMes[tx.mes].despesas += tx.valor;
  }

  const catLines = Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `  ${c}: ${BRL.format(v)}`)
    .join("\n");

  const mesLines = Object.entries(porMes)
    .sort()
    .map(
      ([m, v]) =>
        `  ${m}: Receitas ${BRL.format(v.receitas)} | Despesas ${BRL.format(v.despesas)} | Saldo ${BRL.format(v.receitas - v.despesas)}`,
    )
    .join("\n");

  const dividaLines =
    dividas.length > 0
      ? dividas
          .map(
            (d) =>
              `  - ${d.descricao}: Total ${BRL.format(d.valor_total)}, Pago ${BRL.format(d.valor_pago)}, Restante ${BRL.format(d.valor_total - d.valor_pago)}`,
          )
          .join("\n")
      : "  Nenhuma";

  const metaLines =
    metas.length > 0
      ? metas
          .map(
            (m) =>
              `  - ${m.descricao}: Alvo ${BRL.format(m.valor_alvo)}, Atual ${BRL.format(m.valor_atual)} (${m.status})`,
          )
          .join("\n")
      : "  Nenhuma";

  const rpLines =
    receitasPrevistas.length > 0
      ? receitasPrevistas
          .map(
            (r) =>
              `  - ${r.descricao}: ${BRL.format(r.valor)} previsto p/ ${fmtDate(r.data_prevista)}${r.cliente ? ` (${r.cliente})` : ""}`,
          )
          .join("\n")
      : "  Nenhuma";

  const cpLines =
    contasPagar.length > 0
      ? contasPagar
          .map(
            (c) =>
              `  - ${c.descricao}: ${BRL.format(c.valor)} vence em ${fmtDate(c.data_vencimento)}`,
          )
          .join("\n")
      : "  Nenhuma";

  const context = [
    `=== DADOS FINANCEIROS DE PEDRO (ultimos 90 dias) ===`,
    `Data atual: ${fmtDate(now)}`,
    ``,
    `RESUMO GERAL:`,
    `  Total Receitas: ${BRL.format(totalReceitas)}`,
    `  Total Despesas: ${BRL.format(totalDespesas)}`,
    `  Saldo: ${BRL.format(totalReceitas - totalDespesas)}`,
    `  Transacoes: ${transacoes.length}`,
    ``,
    `POR MES:`,
    mesLines,
    ``,
    `DESPESAS POR CATEGORIA:`,
    catLines,
    ``,
    `DIVIDAS ATIVAS:`,
    dividaLines,
    ``,
    `METAS FINANCEIRAS:`,
    metaLines,
    ``,
    `RECEITAS PREVISTAS:`,
    rpLines,
    ``,
    `CONTAS A PAGAR:`,
    cpLines,
  ].join("\n");

  const result = await chatCompletion({
    model: MAX_DEEP_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Voce e Max, assistente financeiro pessoal de Pedro. Analise os dados financeiros fornecidos e responda a pergunta de forma detalhada, pratica e personalizada. Use valores em reais (R$). Seja direto e de conselhos acionaveis.",
      },
      {
        role: "user",
        content: `${context}\n\n---\n\nPERGUNTA DE PEDRO: ${pergunta}`,
      },
    ],
    max_tokens: 4096,
  });

  return result.choices[0]?.message?.content ?? "Nao foi possivel gerar a analise.";
}

// ---------------------------------------------------------------------------
// projecao_caixa
// ---------------------------------------------------------------------------
export async function projecaoCaixa(args: Record<string, unknown>): Promise<string> {
  const dias = Math.min(Math.max((args.dias as number) ?? 30, 1), 60);
  const now = getBrasiliaNow();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Saldo do mes atual
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1);
  const txMes = await prisma.transacao.findMany({
    where: {
      data_transacao: { gte: inicioMes, lt: new Date(today.getTime() + 86_400_000) },
    },
  });

  let saldoAtual = 0;
  for (const tx of txMes) {
    if (tx.tipo === "receita") saldoAtual += tx.valor;
    else saldoAtual -= tx.valor;
  }

  // Media diaria de despesas (ultimos 60 dias)
  const d60ago = new Date(today);
  d60ago.setDate(d60ago.getDate() - 60);
  const despesas60 = await prisma.transacao.aggregate({
    where: {
      tipo: "despesa",
      data_transacao: { gte: d60ago, lt: new Date(today.getTime() + 86_400_000) },
    },
    _sum: { valor: true },
  });

  const diffDays = Math.max(
    Math.ceil((today.getTime() - d60ago.getTime()) / 86_400_000),
    1,
  );
  const burnDiario = (despesas60._sum.valor ?? 0) / diffDays;

  // Contas a pagar e receitas previstas no periodo
  const fimProjecao = new Date(today);
  fimProjecao.setDate(fimProjecao.getDate() + dias);

  const [contasPagar, receitasPrevistas] = await Promise.all([
    prisma.contaPagarMax.findMany({
      where: {
        status: "pendente",
        data_vencimento: {
          gte: today,
          lt: fimProjecao,
        },
      },
      orderBy: { data_vencimento: "asc" },
    }),
    prisma.receitaPrevistaMax.findMany({
      where: {
        status: { in: ["pendente", "atrasada"] },
        data_prevista: {
          gte: today,
          lt: fimProjecao,
        },
      },
      orderBy: { data_prevista: "asc" },
    }),
  ]);

  // Build day-by-day projection
  const cpByDay: Record<string, number> = {};
  for (const c of contasPagar) {
    const key = c.data_vencimento.toISOString().slice(0, 10);
    cpByDay[key] = (cpByDay[key] ?? 0) + c.valor;
  }

  const rpByDay: Record<string, number> = {};
  for (const r of receitasPrevistas) {
    const key = r.data_prevista.toISOString().slice(0, 10);
    rpByDay[key] = (rpByDay[key] ?? 0) + r.valor;
  }

  const lines: string[] = [
    `PROJECAO DE FLUXO DE CAIXA — ${dias} dias`,
    `Saldo atual (mes): ${BRL.format(saldoAtual)}`,
    `Taxa diaria media de despesas: ${BRL.format(burnDiario)}/dia`,
    ``,
    `${"Data".padEnd(12)} ${"Receitas".padStart(14)} ${"Contas".padStart(14)} ${"Burn".padStart(14)} ${"Saldo".padStart(14)}`,
    "-".repeat(70),
  ];

  let saldo = saldoAtual;
  let primeiroDiaNegativo: string | null = null;

  for (let i = 0; i < dias; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const dataFmt = d.toLocaleDateString("pt-BR");

    const receitaDia = rpByDay[key] ?? 0;
    const contaDia = cpByDay[key] ?? 0;
    const burnDia = i === 0 ? 0 : burnDiario; // hoje ja contabilizado

    saldo = saldo + receitaDia - contaDia - burnDia;

    const marker = saldo < 0 ? " **" : "";
    if (saldo < 0 && !primeiroDiaNegativo) {
      primeiroDiaNegativo = dataFmt;
    }

    // Only show lines with events or every 7 days or first/last day
    const hasEvent = receitaDia > 0 || contaDia > 0;
    if (hasEvent || i === 0 || i === dias - 1 || i % 7 === 0) {
      lines.push(
        `${dataFmt.padEnd(12)} ${(receitaDia > 0 ? "+" + BRL.format(receitaDia) : "-").padStart(14)} ${(contaDia > 0 ? "-" + BRL.format(contaDia) : "-").padStart(14)} ${("-" + BRL.format(burnDia)).padStart(14)} ${BRL.format(saldo).padStart(14)}${marker}`,
      );
    }
  }

  lines.push("");
  lines.push("-".repeat(70));
  lines.push(`Saldo projetado final: ${BRL.format(saldo)}`);

  if (primeiroDiaNegativo) {
    lines.push(`\nATENCAO: Saldo fica negativo a partir de ${primeiroDiaNegativo}!`);
  } else {
    lines.push(`\nSaldo se mantem positivo durante todo o periodo.`);
  }

  const totalContasFuturas = contasPagar.reduce((s, c) => s + c.valor, 0);
  const totalReceitasFuturas = receitasPrevistas.reduce((s, r) => s + r.valor, 0);

  lines.push("");
  lines.push(`Resumo do periodo:`);
  lines.push(`  Receitas previstas: ${BRL.format(totalReceitasFuturas)}`);
  lines.push(`  Contas a pagar: ${BRL.format(totalContasFuturas)}`);
  lines.push(`  Burn estimado (${dias}d): ${BRL.format(burnDiario * dias)}`);

  return lines.join("\n");
}
