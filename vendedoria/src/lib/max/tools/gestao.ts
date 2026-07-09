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

// ===========================================================================
// DIVIDAS
// ===========================================================================
export async function gerenciarDivida(args: Record<string, unknown>): Promise<string> {
  const acao = args.acao as string;

  switch (acao) {
    case "listar": {
      const dividas = await prisma.dividaMax.findMany({
        where: { status: "ativa" },
        orderBy: { criado_em: "desc" },
      });

      if (dividas.length === 0) return "Nenhuma divida ativa encontrada.";

      const lines = dividas.map((d) => {
        const pct = d.valor_total > 0 ? Math.round((d.valor_pago / d.valor_total) * 100) : 0;
        const restante = d.valor_total - d.valor_pago;
        return [
          `[${d.id}] ${d.descricao}${d.credor ? ` (${d.credor})` : ""}`,
          `  Total: ${BRL.format(d.valor_total)} | Pago: ${BRL.format(d.valor_pago)} (${pct}%) | Restante: ${BRL.format(restante)}`,
          d.parcela_mensal ? `  Parcela mensal: ${BRL.format(d.parcela_mensal)}` : null,
          d.dia_vencimento ? `  Vencimento: dia ${d.dia_vencimento}` : null,
          d.observacao ? `  Obs: ${d.observacao}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      });

      const totalRestante = dividas.reduce((s, d) => s + (d.valor_total - d.valor_pago), 0);

      return [
        `Dividas ativas (${dividas.length}):`,
        "",
        ...lines,
        "",
        `Total restante: ${BRL.format(totalRestante)}`,
      ].join("\n");
    }

    case "pagar_parcela": {
      const id = args.id as string;
      const valor = Math.round((args.valor as number) * 100) / 100;

      if (!id) return "ID da divida e obrigatorio para pagar parcela.";
      if (!valor) return "Valor do pagamento e obrigatorio.";

      const divida = await prisma.dividaMax.findUnique({ where: { id } });
      if (!divida) return `Divida com ID "${id}" nao encontrada.`;

      const novoValorPago = Math.round((divida.valor_pago + valor) * 100) / 100;
      const novoStatus = novoValorPago >= divida.valor_total ? "quitada" : "ativa";

      await prisma.dividaMax.update({
        where: { id },
        data: {
          valor_pago: novoValorPago,
          status: novoStatus,
        },
      });

      // Registrar despesa
      const now = getBrasiliaNow();
      await prisma.transacao.create({
        data: {
          tipo: "despesa",
          valor,
          descricao: `Parcela: ${divida.descricao}`,
          categoria: "Dívidas/Parcelas",
          tipo_negocio: "pessoal",
          data_transacao: now,
          mes: formatMes(now),
          confirmado: true,
        },
      });

      const restante = Math.max(divida.valor_total - novoValorPago, 0);

      return [
        `Pagamento de ${BRL.format(valor)} registrado para "${divida.descricao}".`,
        `  Pago total: ${BRL.format(novoValorPago)} / ${BRL.format(divida.valor_total)}`,
        `  Restante: ${BRL.format(restante)}`,
        novoStatus === "quitada" ? "  Divida QUITADA!" : null,
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "quitar": {
      const id = args.id as string;
      if (!id) return "ID da divida e obrigatorio para quitar.";

      const divida = await prisma.dividaMax.findUnique({ where: { id } });
      if (!divida) return `Divida com ID "${id}" nao encontrada.`;

      await prisma.dividaMax.update({
        where: { id },
        data: {
          valor_pago: divida.valor_total,
          status: "quitada",
        },
      });

      return `Divida "${divida.descricao}" marcada como QUITADA (${BRL.format(divida.valor_total)}).`;
    }

    default:
      return `Acao "${acao}" nao reconhecida para dividas.`;
  }
}

// ===========================================================================
// RECEITAS PREVISTAS
// ===========================================================================
export async function gerenciarReceitaPrevista(args: Record<string, unknown>): Promise<string> {
  const acao = args.acao as string;

  switch (acao) {
    case "criar": {
      const descricao = args.descricao as string;
      const valor = Math.round((args.valor as number) * 100) / 100;
      const dataPrevista = parseDate(args.data_prevista as string);

      const receita = await prisma.receitaPrevistaMax.create({
        data: {
          descricao,
          valor,
          data_prevista: dataPrevista,
          tipo_negocio: (args.tipo_negocio as string) ?? null,
          cliente: (args.cliente as string) ?? null,
          status: "pendente",
        },
      });

      return [
        `Receita prevista criada (ID: ${receita.id}):`,
        `  ${descricao} — ${BRL.format(valor)}`,
        `  Data prevista: ${fmtDate(dataPrevista)}`,
        args.cliente ? `  Cliente: ${args.cliente}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "listar": {
      const receitas = await prisma.receitaPrevistaMax.findMany({
        where: { status: { in: ["pendente", "atrasada"] } },
        orderBy: { data_prevista: "asc" },
      });

      if (receitas.length === 0) return "Nenhuma receita prevista pendente.";

      const now = getBrasiliaNow();
      const lines = receitas.map((r) => {
        const atrasada = r.data_prevista < now && r.status === "pendente";
        return `[${r.id}] ${fmtDate(r.data_prevista)} | ${BRL.format(r.valor)} | ${r.descricao}${r.cliente ? ` (${r.cliente})` : ""}${atrasada ? " ** ATRASADA **" : ""}`;
      });

      const total = receitas.reduce((s, r) => s + r.valor, 0);

      return [
        `Receitas previstas (${receitas.length}):`,
        "",
        ...lines,
        "",
        `Total previsto: ${BRL.format(total)}`,
      ].join("\n");
    }

    case "confirmar": {
      const id = args.id as string;
      if (!id) return "ID da receita prevista e obrigatorio para confirmar.";

      const receita = await prisma.receitaPrevistaMax.findUnique({ where: { id } });
      if (!receita) return `Receita prevista com ID "${id}" nao encontrada.`;

      const now = getBrasiliaNow();

      // Criar transacao de receita
      await prisma.transacao.create({
        data: {
          tipo: "receita",
          valor: receita.valor,
          descricao: receita.descricao,
          categoria: "Renda Variável",
          tipo_negocio: receita.tipo_negocio ?? "geral",
          empresa: receita.cliente,
          data_transacao: now,
          mes: formatMes(now),
          confirmado: true,
        },
      });

      // Marcar como recebida
      await prisma.receitaPrevistaMax.update({
        where: { id },
        data: {
          status: "recebida",
          data_recebimento: now,
        },
      });

      return `Receita "${receita.descricao}" confirmada: ${BRL.format(receita.valor)} registrado como receita.`;
    }

    default:
      return `Acao "${acao}" nao reconhecida para receitas previstas.`;
  }
}

// ===========================================================================
// CONTAS A PAGAR
// ===========================================================================
export async function gerenciarContaPagar(args: Record<string, unknown>): Promise<string> {
  const acao = args.acao as string;

  switch (acao) {
    case "criar": {
      const descricao = args.descricao as string;
      const valor = Math.round((args.valor as number) * 100) / 100;
      const dataVencimento = parseDate(args.data_vencimento as string);
      const categoria = (args.categoria as string) ?? "Outros";
      const tipoNegocio = (args.tipo_negocio as string) ?? "pessoal";
      const recorrente = (args.recorrente as boolean) ?? false;
      const frequencia = (args.frequencia as string) ?? null;

      const conta = await prisma.contaPagarMax.create({
        data: {
          descricao,
          valor,
          data_vencimento: dataVencimento,
          categoria,
          tipo_negocio: tipoNegocio,
          recorrente,
          frequencia,
          status: "pendente",
        },
      });

      return [
        `Conta a pagar criada (ID: ${conta.id}):`,
        `  ${descricao} — ${BRL.format(valor)}`,
        `  Vencimento: ${fmtDate(dataVencimento)}`,
        `  Categoria: ${categoria} | Negocio: ${tipoNegocio}`,
        recorrente ? `  Recorrente: ${frequencia}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "listar": {
      const contas = await prisma.contaPagarMax.findMany({
        where: { status: "pendente" },
        orderBy: { data_vencimento: "asc" },
      });

      if (contas.length === 0) return "Nenhuma conta a pagar pendente.";

      const now = getBrasiliaNow();
      const lines = contas.map((c) => {
        const vencida = c.data_vencimento < now;
        return `[${c.id}] ${fmtDate(c.data_vencimento)} | ${BRL.format(c.valor)} | ${c.descricao} | ${c.categoria}${c.recorrente ? ` (${c.frequencia})` : ""}${vencida ? " ** VENCIDA **" : ""}`;
      });

      const total = contas.reduce((s, c) => s + c.valor, 0);

      return [
        `Contas a pagar pendentes (${contas.length}):`,
        "",
        ...lines,
        "",
        `Total: ${BRL.format(total)}`,
      ].join("\n");
    }

    case "pagar": {
      const id = args.id as string;
      if (!id) return "ID da conta e obrigatorio para pagar.";

      const conta = await prisma.contaPagarMax.findUnique({ where: { id } });
      if (!conta) return `Conta com ID "${id}" nao encontrada.`;

      const now = getBrasiliaNow();

      // Criar transacao de despesa
      const tx = await prisma.transacao.create({
        data: {
          tipo: "despesa",
          valor: conta.valor,
          descricao: conta.descricao,
          categoria: conta.categoria,
          tipo_negocio: conta.tipo_negocio,
          data_transacao: now,
          mes: formatMes(now),
          confirmado: true,
        },
      });

      // Marcar como paga
      await prisma.contaPagarMax.update({
        where: { id },
        data: {
          status: "paga",
          transacao_id: tx.id,
        },
      });

      // Se recorrente, criar proxima ocorrencia
      if (conta.recorrente && conta.frequencia) {
        const proximaData = calcularProximaData(conta.data_vencimento, conta.frequencia);
        await prisma.contaPagarMax.create({
          data: {
            descricao: conta.descricao,
            valor: conta.valor,
            data_vencimento: proximaData,
            categoria: conta.categoria,
            tipo_negocio: conta.tipo_negocio,
            recorrente: true,
            frequencia: conta.frequencia,
            status: "pendente",
          },
        });

        return [
          `Conta "${conta.descricao}" paga: ${BRL.format(conta.valor)}`,
          `Proxima ocorrencia criada para ${fmtDate(proximaData)}.`,
        ].join("\n");
      }

      return `Conta "${conta.descricao}" paga: ${BRL.format(conta.valor)} registrado como despesa.`;
    }

    case "cancelar": {
      const id = args.id as string;
      if (!id) return "ID da conta e obrigatorio para cancelar.";

      const conta = await prisma.contaPagarMax.findUnique({ where: { id } });
      if (!conta) return `Conta com ID "${id}" nao encontrada.`;

      await prisma.contaPagarMax.update({
        where: { id },
        data: { status: "cancelada" },
      });

      return `Conta "${conta.descricao}" (${BRL.format(conta.valor)}) cancelada.`;
    }

    default:
      return `Acao "${acao}" nao reconhecida para contas a pagar.`;
  }
}

function calcularProximaData(dataAtual: Date, frequencia: string): Date {
  const d = new Date(dataAtual);
  switch (frequencia) {
    case "semanal":
      d.setDate(d.getDate() + 7);
      break;
    case "mensal":
      d.setMonth(d.getMonth() + 1);
      break;
    case "anual":
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}

// ===========================================================================
// ORCAMENTOS
// ===========================================================================
export async function gerenciarOrcamento(args: Record<string, unknown>): Promise<string> {
  const acao = args.acao as string;

  switch (acao) {
    case "definir": {
      const categoria = args.categoria as string;
      const limiteMensal = Math.round((args.limite_mensal as number) * 100) / 100;

      if (!categoria) return "Categoria e obrigatoria para definir orcamento.";
      if (!limiteMensal) return "Limite mensal e obrigatorio.";

      await prisma.orcamentoMax.upsert({
        where: { categoria },
        update: { limite_mensal: limiteMensal },
        create: { categoria, limite_mensal: limiteMensal },
      });

      return `Orcamento definido: ${categoria} = ${BRL.format(limiteMensal)}/mes`;
    }

    case "listar": {
      const orcamentos = await prisma.orcamentoMax.findMany({
        orderBy: { categoria: "asc" },
      });

      if (orcamentos.length === 0) return "Nenhum orcamento definido.";

      const now = getBrasiliaNow();
      const mesAtual = formatMes(now);

      // Buscar gastos do mes atual por categoria
      const despesasMes = await prisma.transacao.groupBy({
        by: ["categoria"],
        where: {
          tipo: "despesa",
          mes: mesAtual,
        },
        _sum: { valor: true },
      });

      const gastoMap: Record<string, number> = {};
      for (const d of despesasMes) {
        gastoMap[d.categoria] = d._sum.valor ?? 0;
      }

      const lines = orcamentos.map((o) => {
        const gasto = gastoMap[o.categoria] ?? 0;
        const pct = o.limite_mensal > 0 ? Math.round((gasto / o.limite_mensal) * 100) : 0;
        const status = pct >= 100 ? "ESTOURADO" : pct >= 80 ? "ATENCAO" : "OK";
        return `  ${o.categoria.padEnd(20)} ${BRL.format(gasto).padStart(14)} / ${BRL.format(o.limite_mensal).padStart(14)} (${pct}%) [${status}]`;
      });

      return [
        `Orcamentos — ${mesAtual}:`,
        `${"  Categoria".padEnd(22)} ${"Gasto".padStart(14)}   ${"Limite".padStart(14)}`,
        "",
        ...lines,
      ].join("\n");
    }

    case "remover": {
      const categoria = args.categoria as string;
      if (!categoria) return "Categoria e obrigatoria para remover orcamento.";

      const existing = await prisma.orcamentoMax.findUnique({ where: { categoria } });
      if (!existing) return `Orcamento para "${categoria}" nao encontrado.`;

      await prisma.orcamentoMax.delete({ where: { categoria } });

      return `Orcamento de "${categoria}" removido.`;
    }

    default:
      return `Acao "${acao}" nao reconhecida para orcamentos.`;
  }
}

// ===========================================================================
// TAREFAS
// ===========================================================================
export async function gerenciarTarefa(args: Record<string, unknown>): Promise<string> {
  const acao = args.acao as string;

  switch (acao) {
    case "criar": {
      const descricao = args.descricao as string;
      if (!descricao) return "Descricao e obrigatoria para criar tarefa.";

      const recorrente = (args.recorrente as boolean) ?? false;
      const frequencia = (args.frequencia as string) ?? null;
      const proximaCobranca = args.proxima_cobranca
        ? new Date(args.proxima_cobranca as string)
        : null;

      const tarefa = await prisma.tarefaMax.create({
        data: {
          descricao,
          recorrente,
          frequencia,
          proxima_cobranca: proximaCobranca,
          status: "ativa",
          historico: [],
        },
      });

      return [
        `Tarefa criada (ID: ${tarefa.id}):`,
        `  "${descricao}"`,
        recorrente ? `  Recorrente: ${frequencia}` : null,
        proximaCobranca
          ? `  Proxima cobranca: ${proximaCobranca.toLocaleDateString("pt-BR")} ${proximaCobranca.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "listar": {
      const tarefas = await prisma.tarefaMax.findMany({
        where: { status: "ativa" },
        orderBy: { proxima_cobranca: "asc" },
      });

      if (tarefas.length === 0) return "Nenhuma tarefa ativa.";

      const lines = tarefas.map((t, i) => {
        const prox = t.proxima_cobranca
          ? `${t.proxima_cobranca.toLocaleDateString("pt-BR")} ${t.proxima_cobranca.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
          : "sem cobranca agendada";
        return `${i + 1}. [${t.id}] ${t.descricao}${t.recorrente ? ` (${t.frequencia})` : ""} — ${prox}`;
      });

      return [`Tarefas ativas (${tarefas.length}):`, "", ...lines].join("\n");
    }

    case "concluir": {
      const id = args.id as string;
      if (!id) return "ID da tarefa e obrigatorio para concluir.";

      const tarefa = await prisma.tarefaMax.findUnique({ where: { id } });
      if (!tarefa) return `Tarefa com ID "${id}" nao encontrada.`;

      await prisma.tarefaMax.update({
        where: { id },
        data: { status: "concluida" },
      });

      return `Tarefa "${tarefa.descricao}" marcada como concluida.`;
    }

    case "cancelar": {
      const id = args.id as string;
      if (!id) return "ID da tarefa e obrigatorio para cancelar.";

      const tarefa = await prisma.tarefaMax.findUnique({ where: { id } });
      if (!tarefa) return `Tarefa com ID "${id}" nao encontrada.`;

      await prisma.tarefaMax.update({
        where: { id },
        data: { status: "cancelada" },
      });

      return `Tarefa "${tarefa.descricao}" cancelada.`;
    }

    case "registrar_resposta": {
      const id = args.id as string;
      const resposta = args.resposta as string;
      if (!id) return "ID da tarefa e obrigatorio.";
      if (!resposta) return "Resposta e obrigatoria.";

      const tarefa = await prisma.tarefaMax.findUnique({ where: { id } });
      if (!tarefa) return `Tarefa com ID "${id}" nao encontrada.`;

      const now = getBrasiliaNow();
      const historico = (tarefa.historico as Array<{ data: string; resposta: string }>) ?? [];
      historico.push({
        data: now.toISOString(),
        resposta,
      });

      // Calcular proxima cobranca se recorrente
      let proximaCobranca: Date | null = null;
      if (tarefa.recorrente && tarefa.frequencia) {
        proximaCobranca = calcularProximaCobranca(now, tarefa.frequencia);
      }

      await prisma.tarefaMax.update({
        where: { id },
        data: {
          historico,
          proxima_cobranca: proximaCobranca ?? tarefa.proxima_cobranca,
        },
      });

      return [
        `Resposta registrada para "${tarefa.descricao}":`,
        `  "${resposta}"`,
        proximaCobranca
          ? `  Proxima cobranca: ${proximaCobranca.toLocaleDateString("pt-BR")} ${proximaCobranca.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
    }

    default:
      return `Acao "${acao}" nao reconhecida para tarefas.`;
  }
}

function calcularProximaCobranca(dataAtual: Date, frequencia: string): Date {
  const d = new Date(dataAtual);
  switch (frequencia) {
    case "diario":
      d.setDate(d.getDate() + 1);
      break;
    case "semanal":
      d.setDate(d.getDate() + 7);
      break;
    case "mensal":
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d;
}
