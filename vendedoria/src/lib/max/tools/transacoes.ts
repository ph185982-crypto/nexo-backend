import { prisma } from "@/lib/prisma/client";
import { getBrasiliaNow, formatMes } from "../config";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function fmtDate(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ---------------------------------------------------------------------------
// registrar_transacao
// ---------------------------------------------------------------------------
export async function registrarTransacao(args: Record<string, unknown>): Promise<string> {
  const now = getBrasiliaNow();
  const dataStr = (args.data as string) ?? null;
  const dataTransacao = dataStr ? parseDate(dataStr) : now;
  const valor = Math.round((args.valor as number) * 100) / 100;

  const tx = await prisma.transacao.create({
    data: {
      tipo: args.tipo as string,
      valor,
      descricao: args.descricao as string,
      categoria: args.categoria as string,
      tipo_negocio: args.tipo_negocio as string,
      empresa: (args.empresa as string) ?? null,
      data_transacao: dataTransacao,
      mes: formatMes(dataTransacao),
      confirmado: true,
    },
  });

  // Mini-extrato do dia
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 86_400_000);

  const todayTxs = await prisma.transacao.findMany({
    where: {
      data_transacao: { gte: startOfDay, lt: endOfDay },
    },
  });

  let totalReceitas = 0;
  let totalDespesas = 0;
  for (const t of todayTxs) {
    if (t.tipo === "receita") totalReceitas += t.valor;
    else totalDespesas += t.valor;
  }

  return [
    `Transacao registrada (ID: ${tx.id}):`,
    `  ${tx.tipo === "receita" ? "+" : "-"} ${BRL.format(tx.valor)} — ${tx.descricao} [${tx.categoria}]`,
    ``,
    `Resumo de hoje (${fmtDate(now)}):`,
    `  Receitas: ${BRL.format(totalReceitas)}`,
    `  Despesas: ${BRL.format(totalDespesas)}`,
    `  Saldo do dia: ${BRL.format(totalReceitas - totalDespesas)}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// desfazer_ultima
// ---------------------------------------------------------------------------
export async function desfazerUltima(args: Record<string, unknown>): Promise<string> {
  const id = args.id as string | undefined;

  let tx;
  if (id) {
    tx = await prisma.transacao.findUnique({ where: { id } });
    if (!tx) return `Transacao com ID "${id}" nao encontrada.`;
  } else {
    tx = await prisma.transacao.findFirst({
      orderBy: { criado_em: "desc" },
    });
    if (!tx) return "Nenhuma transacao encontrada para desfazer.";
  }

  await prisma.transacao.delete({ where: { id: tx.id } });

  return [
    `Transacao excluida:`,
    `  ${tx.tipo === "receita" ? "+" : "-"} ${BRL.format(tx.valor)} — ${tx.descricao}`,
    `  Data: ${fmtDate(tx.data_transacao)} | Categoria: ${tx.categoria}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// buscar_transacoes
// ---------------------------------------------------------------------------
export async function buscarTransacoes(args: Record<string, unknown>): Promise<string> {
  const limite = Math.min((args.limite as number) ?? 30, 100);

  const where: Record<string, unknown> = {};

  if (args.data_inicio || args.data_fim) {
    const dtFilter: Record<string, Date> = {};
    if (args.data_inicio) dtFilter.gte = parseDate(args.data_inicio as string);
    if (args.data_fim) {
      const fim = parseDate(args.data_fim as string);
      dtFilter.lte = new Date(fim.getTime() + 86_400_000 - 1);
    }
    where.data_transacao = dtFilter;
  }

  if (args.texto) {
    where.OR = [
      { descricao: { contains: args.texto as string, mode: "insensitive" } },
      { empresa: { contains: args.texto as string, mode: "insensitive" } },
    ];
  }

  if (args.categoria) where.categoria = args.categoria;
  if (args.tipo) where.tipo = args.tipo;
  if (args.tipo_negocio) where.tipo_negocio = args.tipo_negocio;

  const txs = await prisma.transacao.findMany({
    where,
    orderBy: { data_transacao: "desc" },
    take: limite,
  });

  if (txs.length === 0) return "Nenhuma transacao encontrada com os filtros informados.";

  const lines = txs.map(
    (t) =>
      `[${t.id}] ${fmtDate(t.data_transacao)} | ${t.tipo === "receita" ? "+" : "-"}${BRL.format(t.valor)} | ${t.descricao} | ${t.categoria} | ${t.tipo_negocio}${t.empresa ? ` | ${t.empresa}` : ""}`,
  );

  return [`Encontradas ${txs.length} transacoes:`, "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// editar_transacao
// ---------------------------------------------------------------------------
export async function editarTransacao(args: Record<string, unknown>): Promise<string> {
  const id = args.id as string;

  const existing = await prisma.transacao.findUnique({ where: { id } });
  if (!existing) return `Transacao com ID "${id}" nao encontrada.`;

  const data: Record<string, unknown> = {};

  if (args.valor !== undefined) data.valor = Math.round((args.valor as number) * 100) / 100;
  if (args.descricao !== undefined) data.descricao = args.descricao;
  if (args.categoria !== undefined) data.categoria = args.categoria;
  if (args.tipo !== undefined) data.tipo = args.tipo;
  if (args.tipo_negocio !== undefined) data.tipo_negocio = args.tipo_negocio;
  if (args.empresa !== undefined) data.empresa = args.empresa;

  if (args.data_transacao !== undefined) {
    const newDate = parseDate(args.data_transacao as string);
    data.data_transacao = newDate;
    data.mes = formatMes(newDate);
  }

  if (Object.keys(data).length === 0) return "Nenhum campo para atualizar informado.";

  const updated = await prisma.transacao.update({
    where: { id },
    data,
  });

  return [
    `Transacao atualizada (ID: ${updated.id}):`,
    `  Tipo: ${updated.tipo}`,
    `  Valor: ${BRL.format(updated.valor)}`,
    `  Descricao: ${updated.descricao}`,
    `  Categoria: ${updated.categoria}`,
    `  Negocio: ${updated.tipo_negocio}`,
    `  Data: ${fmtDate(updated.data_transacao)}`,
    updated.empresa ? `  Empresa: ${updated.empresa}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// excluir_transacao
// ---------------------------------------------------------------------------
export async function excluirTransacao(args: Record<string, unknown>): Promise<string> {
  const id = args.id as string;

  const tx = await prisma.transacao.findUnique({ where: { id } });
  if (!tx) return `Transacao com ID "${id}" nao encontrada.`;

  await prisma.transacao.delete({ where: { id } });

  return `Transacao excluida: ${tx.tipo === "receita" ? "+" : "-"}${BRL.format(tx.valor)} — ${tx.descricao} (${fmtDate(tx.data_transacao)})`;
}

// ---------------------------------------------------------------------------
// gerar_extrato
// ---------------------------------------------------------------------------
export async function gerarExtrato(args: Record<string, unknown>): Promise<string> {
  const dataInicio = parseDate(args.data_inicio as string);
  const dataFim = parseDate(args.data_fim as string);

  const where: Record<string, unknown> = {
    data_transacao: {
      gte: dataInicio,
      lte: new Date(dataFim.getTime() + 86_400_000 - 1),
    },
  };

  if (args.tipo_negocio) where.tipo_negocio = args.tipo_negocio;
  if (args.categoria) where.categoria = args.categoria;

  const txs = await prisma.transacao.findMany({
    where,
    orderBy: { data_transacao: "asc" },
  });

  if (txs.length === 0) return `Nenhuma transacao encontrada entre ${fmtDate(dataInicio)} e ${fmtDate(dataFim)}.`;

  let totalReceitas = 0;
  let totalDespesas = 0;
  const porCategoria: Record<string, number> = {};

  const lines: string[] = [
    `EXTRATO FINANCEIRO`,
    `Periodo: ${fmtDate(dataInicio)} a ${fmtDate(dataFim)}`,
    args.tipo_negocio ? `Negocio: ${args.tipo_negocio}` : null,
    args.categoria ? `Categoria: ${args.categoria}` : null,
    `${"=".repeat(60)}`,
    "",
  ].filter(Boolean) as string[];

  for (const tx of txs) {
    const sign = tx.tipo === "receita" ? "+" : "-";
    lines.push(
      `${fmtDate(tx.data_transacao)} | ${tx.descricao.padEnd(30)} | ${tx.categoria.padEnd(16)} | ${sign} ${BRL.format(tx.valor)}`,
    );

    if (tx.tipo === "receita") {
      totalReceitas += tx.valor;
    } else {
      totalDespesas += tx.valor;
    }

    const catKey = `${tx.tipo}:${tx.categoria}`;
    porCategoria[catKey] = (porCategoria[catKey] ?? 0) + tx.valor;
  }

  lines.push("");
  lines.push("=".repeat(60));
  lines.push("TOTAIS POR CATEGORIA:");
  lines.push("");

  const sortedCats = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
  for (const [catKey, total] of sortedCats) {
    const [tipo, cat] = catKey.split(":");
    const sign = tipo === "receita" ? "+" : "-";
    lines.push(`  ${cat.padEnd(20)} ${sign} ${BRL.format(total)}`);
  }

  lines.push("");
  lines.push("=".repeat(60));
  lines.push("RESUMO:");
  lines.push(`  Total Receitas:  + ${BRL.format(totalReceitas)}`);
  lines.push(`  Total Despesas:  - ${BRL.format(totalDespesas)}`);
  lines.push(`  Saldo:           ${BRL.format(totalReceitas - totalDespesas)}`);
  lines.push(`  Transacoes:      ${txs.length}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// consultar_financas
// ---------------------------------------------------------------------------
export async function consultarFinancas(args: Record<string, unknown>): Promise<string> {
  const now = getBrasiliaNow();
  const periodo = args.periodo as string;

  let start: Date;
  let end: Date;
  let label: string;

  switch (periodo) {
    case "hoje": {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(start.getTime() + 86_400_000);
      label = `Hoje (${fmtDate(now)})`;
      break;
    }
    case "ontem": {
      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      start = yesterday;
      end = new Date(yesterday.getTime() + 86_400_000);
      label = `Ontem (${fmtDate(yesterday)})`;
      break;
    }
    case "semana": {
      const dayOfWeek = now.getDay();
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((dayOfWeek + 6) % 7));
      start = monday;
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      label = `Semana (${fmtDate(monday)} a ${fmtDate(now)})`;
      break;
    }
    case "mes": {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      label = `Mes atual (${fmtDate(start)} a ${fmtDate(now)})`;
      break;
    }
    case "mes_passado": {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 1);
      label = `Mes passado (${fmtDate(start)} a ${fmtDate(new Date(end.getTime() - 86_400_000))})`;
      break;
    }
    default:
      return `Periodo "${periodo}" nao reconhecido.`;
  }

  const where: Record<string, unknown> = {
    data_transacao: { gte: start, lt: end },
  };

  if (args.tipo_negocio) where.tipo_negocio = args.tipo_negocio;
  if (args.categoria) where.categoria = args.categoria;

  const txs = await prisma.transacao.findMany({ where });

  let totalReceitas = 0;
  let totalDespesas = 0;
  const porCategoria: Record<string, number> = {};

  for (const tx of txs) {
    if (tx.tipo === "receita") {
      totalReceitas += tx.valor;
    } else {
      totalDespesas += tx.valor;
    }
    if (tx.tipo === "despesa") {
      porCategoria[tx.categoria] = (porCategoria[tx.categoria] ?? 0) + tx.valor;
    }
  }

  const saldo = totalReceitas - totalDespesas;

  const lines: string[] = [
    `Resumo financeiro — ${label}`,
    args.tipo_negocio ? `Negocio: ${args.tipo_negocio}` : null,
    args.categoria ? `Categoria: ${args.categoria}` : null,
    "",
    `  Receitas: ${BRL.format(totalReceitas)}`,
    `  Despesas: ${BRL.format(totalDespesas)}`,
    `  Saldo:    ${BRL.format(saldo)}`,
    `  Transacoes: ${txs.length}`,
  ].filter(Boolean) as string[];

  if (Object.keys(porCategoria).length > 0) {
    lines.push("");
    lines.push("  Despesas por categoria:");
    const sorted = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
    for (const [cat, total] of sorted) {
      lines.push(`    ${cat.padEnd(20)} ${BRL.format(total)}`);
    }
  }

  return lines.join("\n");
}
