import { prisma } from "@/lib/prisma/client";
import { getBrasiliaNow, formatMes } from "./config";

// Mesma lista EXATA do enum da tool registrar_transacao (com acentos) —
// se divergir, o modelo erra a categoria e cai em "Outros".
const CATEGORIAS = [
  "Moradia", "Transporte", "Alimentação", "Saúde", "Lazer", "Vestuário",
  "Assinaturas", "Negócios", "Dívidas/Parcelas", "Fornecedor", "Marketing",
  "Salário", "Renda Variável", "Outros",
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
    ? contasVencer.map((c) => `- [id:${c.id}] ${c.descricao}: ${brl(c.valor)} vence ${c.data_vencimento.toLocaleDateString("pt-BR", { timeZone: "UTC" })}`).join("\n")
    : "Nenhuma";

  const receitasStr = receitasPendentes.length > 0
    ? receitasPendentes.map((r) => `- [id:${r.id}] ${r.descricao}: ${brl(r.valor)} prev ${r.data_prevista.toLocaleDateString("pt-BR", { timeZone: "UTC" })}${r.cliente ? ` (${r.cliente})` : ""}`).join("\n")
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

REGRAS DE CLASSIFICACAO (use SEMPRE uma categoria da lista, nunca invente; use "Outros" so em ultimo caso):
- Alimentação: mercado, supermercado, feira, padaria, restaurante, lanche, sorvete, água, café, ifood, açougue, hortifruti
- Transporte: uber, 99, combustivel, gasolina, estacionamento, pedagio, lava jato, tapete/acessorio de carro, mecanico, oficina
- Moradia: aluguel, condominio, luz/energia, agua (conta), gas, IPTU, reforma, moveis
- Saúde: farmacia, remedio, medico, dentista, plano de saude, exame, academia
- Assinaturas: netflix, spotify, streaming, software mensal, apps
- Vestuário: roupa, calçado, moda, acessorio pessoal
- Dívidas/Parcelas: parcela de algo, emprestimo, financiamento, cartao (fatura)
- Negócios/Fornecedor/Marketing: gastos das empresas (Vendedoria/LuKaizen), fornecedor, anuncios/trafego
- Salário / Renda Variável: entradas (salario fixo = Salário; vendas/freelance/recebimentos = Renda Variável)
- Pet (ração, veterinario): use Outros (nao ha categoria pet)
- Na duvida entre 2, escolha a mais especifica. Itens do dia a dia quase nunca sao "Outros".

RECEITAS PREVISTAS E CONTAS (dar baixa, NAO duplicar):
- Se o usuario disser que uma RECEITA PREVISTA pendente entrou (ex: "o Rodrigo pagou", "a Effata pagou os 1000", "caiu o pagamento da Lumiere"), use gerenciar_receita_prevista acao:confirmar com o [id] da lista RECEITAS PREVISTAS PENDENTES. NAO registre uma transacao nova — o confirmar ja lanca a receita e da baixa.
- Se o usuario disser que pagou uma CONTA A VENCER da lista, use gerenciar_conta_pagar acao:pagar com o [id]. Nao registre despesa manual duplicada.
- Só registre transacao nova (registrar_transacao) quando NAO existir receita prevista/conta correspondente na lista.

DESPESAS/RECEITAS RECORRENTES:
- Se o usuario disser que algo se repete todo mes/semana (ex: "todo mes pago 450 de condominio", "assinatura de 39 por mes"), crie com gerenciar_conta_pagar recorrente:true e a frequencia certa — nao registre so uma vez.

REGRAS DE COMPORTAMENTO:
- Assistente completo: financas, agenda, lembretes, pesquisa, conversas
- SEJA CONCISO por padrao: respostas curtas e diretas, no maximo 2-3 linhas. Nada de relatorios longos a menos que o usuario peça "extrato" ou "relatorio completo".
- Extrato/relatorio completo (so quando pedido): liste TODAS as transacoes, sem resumir.
- Tom WhatsApp: sem asteriscos markdown, sem listas desnecessarias, direto e humano
- PROIBIDO frases genericas de fechamento tipo "qualquer coisa estou aqui" ou "se precisar de mais alguma coisa"
- Template registro (curto): (checkmark) [desc] — R$ [valor] [Categoria] (DD/MM)
- Numeros sempre formato BR: R$ com virgula
- DATAS: NAO preencha o campo "data" se o usuario nao mencionar uma data — o sistema usa a data de hoje automaticamente. So preencha "data" quando o usuario disser explicitamente (ontem, dia 20, 01/07, semana passada). NUNCA copie a data de mensagens anteriores.
- Confirmacao de registro SEMPRE mostra a data usada: ex: "Registrado em 26/07".`;

}
