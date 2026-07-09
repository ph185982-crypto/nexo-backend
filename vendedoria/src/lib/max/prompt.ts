import { prisma } from "@/lib/prisma/client";
import { getBrasiliaNow, formatMes } from "./config";

const CATEGORIAS = [
  "Moradia", "Transporte", "Alimentacao", "Saude", "Lazer", "Vestuario",
  "Assinaturas", "Negocios", "Dividas/Parcelas", "Fornecedor", "Marketing",
  "Salario", "Renda Variavel", "Outros",
] as const;

function brl(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

export async function buildMaxSystemPrompt(): Promise<string> {
  const agora = getBrasiliaNow();
  const mesAtual = formatMes(agora);
  const em7dias = new Date(agora);
  em7dias.setDate(em7dias.getDate() + 7);

  const [
    transacoesMes,
    topGastos,
    lembretes,
    dividas,
    tarefas,
    metas,
    contasVencer,
    receitasPendentes,
    contextos,
  ] = await Promise.all([
    prisma.transacao.aggregate({
      _sum: { valor: true },
      where: { mes: mesAtual },
      _count: true,
    }).then(async (agg) => {
      const receitas = await prisma.transacao.aggregate({
        _sum: { valor: true },
        where: { mes: mesAtual, tipo: "receita" },
      });
      const despesas = await prisma.transacao.aggregate({
        _sum: { valor: true },
        where: { mes: mesAtual, tipo: "despesa" },
      });
      return {
        receitas: receitas._sum.valor ?? 0,
        despesas: despesas._sum.valor ?? 0,
        total: agg._count,
      };
    }),

    prisma.transacao.groupBy({
      by: ["categoria"],
      _sum: { valor: true },
      where: { mes: mesAtual, tipo: "despesa" },
      orderBy: { _sum: { valor: "desc" } },
      take: 5,
    }),

    prisma.lembreteMax.findMany({
      where: { enviado: false, data_hora: { gte: agora } },
      orderBy: { data_hora: "asc" },
      take: 5,
    }),

    prisma.dividaMax.findMany({
      where: { status: "ativa" },
    }),

    prisma.tarefaMax.findMany({
      where: { status: "ativa" },
    }),

    prisma.metaFinanceiraMax.findMany({
      where: { status: "ativa" },
    }),

    prisma.contaPagarMax.findMany({
      where: {
        status: "pendente",
        data_vencimento: { gte: agora, lte: em7dias },
      },
      orderBy: { data_vencimento: "asc" },
    }),

    prisma.receitaPrevistaMax.findMany({
      where: { status: "pendente" },
      orderBy: { data_prevista: "asc" },
    }),

    prisma.contextoPedro.findMany(),
  ]);

  const saldo = transacoesMes.receitas - transacoesMes.despesas;

  const topGastosStr = topGastos.length > 0
    ? topGastos.map((g, i) => `${i + 1}. ${g.categoria}: ${brl(g._sum.valor ?? 0)}`).join("\n")
    : "Nenhuma despesa registrada";

  const lembrStr = lembretes.length > 0
    ? lembretes.map((l) => `- ${l.descricao} (${l.data_hora.toLocaleDateString("pt-BR")} ${l.data_hora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})`).join("\n")
    : "Nenhum";

  const dividasStr = dividas.length > 0
    ? dividas.map((d) => {
        const pct = d.valor_total > 0 ? Math.round((d.valor_pago / d.valor_total) * 100) : 0;
        return `- ${d.descricao}: ${brl(d.valor_pago)}/${brl(d.valor_total)} (${pct}%)${d.credor ? ` [${d.credor}]` : ""}`;
      }).join("\n")
    : "Nenhuma";

  const tarefasStr = tarefas.length > 0
    ? tarefas.map((t) => `- ${t.descricao}`).join("\n")
    : "Nenhuma";

  const metasStr = metas.length > 0
    ? metas.map((m) => {
        const pct = m.valor_alvo > 0 ? Math.round((m.valor_atual / m.valor_alvo) * 100) : 0;
        return `- ${m.descricao}: ${brl(m.valor_atual)}/${brl(m.valor_alvo)} (${pct}%)`;
      }).join("\n")
    : "Nenhuma";

  const contasStr = contasVencer.length > 0
    ? contasVencer.map((c) => `- ${c.descricao}: ${brl(c.valor)} vence ${c.data_vencimento.toLocaleDateString("pt-BR")}`).join("\n")
    : "Nenhuma";

  const receitasStr = receitasPendentes.length > 0
    ? receitasPendentes.map((r) => `- ${r.descricao}: ${brl(r.valor)} prev ${r.data_prevista.toLocaleDateString("pt-BR")}${r.cliente ? ` (${r.cliente})` : ""}`).join("\n")
    : "Nenhuma";

  const memoriaStr = contextos.length > 0
    ? contextos.map((c) => `${c.chave}: ${c.valor}`).join("\n")
    : "";

  const dataHora = `${agora.toLocaleDateString("pt-BR")} ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

  return `Voce e Max, assistente pessoal do Pedro Henrique -- financas, agenda, negocios, informacao e vida.

CONTEXTO PEDRO: Empreendedor em Goiania-GO. Empresas: Vendedoria (SaaS de automacao WhatsApp), LuKaizen Games (estudio de jogos). Gerencia financas pessoais e empresariais pelo WhatsApp.

DATA/HORA BRASILIA: ${dataHora}

RESUMO ${mesAtual}:
Receitas: ${brl(transacoesMes.receitas)} | Despesas: ${brl(transacoesMes.despesas)} | Saldo: ${brl(saldo)}
Total de lancamentos: ${transacoesMes.total}

TOP 5 GASTOS DO MES:
${topGastosStr}

PROXIMOS LEMBRETES:
${lembrStr}

DIVIDAS ATIVAS:
${dividasStr}

TAREFAS PENDENTES:
${tarefasStr}

METAS:
${metasStr}

CONTAS A VENCER (7 DIAS):
${contasStr}

RECEITAS PREVISTAS PENDENTES:
${receitasStr}

${memoriaStr ? `MEMORIA:\n${memoriaStr}\n` : ""}CATEGORIAS VALIDAS: ${CATEGORIAS.join(", ")}

REGRAS DE CLASSIFICACAO: salario vai em pessoal/Salario, freelance em pessoal/Renda Variavel, vendas Vendedoria em vendedoria/Renda Variavel, aluguel em pessoal/Moradia, uber/combustivel em pessoal/Transporte, mercado/restaurante em pessoal/Alimentacao.

REGRAS DE COMPORTAMENTO:
- Assistente completo: financas, agenda, lembretes, pesquisa, conversas
- Extratos completos: NUNCA resuma, liste TODAS as transacoes
- VAI ALEM: apos responder, adicione 1 frase de insight ou sugestao
- Tom WhatsApp: sem asteriscos markdown, sem listas desnecessarias, direto e humano
- PROIBIDO frases genericas de fechamento tipo "qualquer coisa estou aqui"
- Template registro: (checkmark) [desc] -- R$ [valor]
- Numeros sempre formato BR: R$ com virgula`;
}
