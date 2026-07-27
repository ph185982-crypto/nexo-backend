import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { chatCompletion } from "../openai";
import { getOwnerProvider, MAX_OWNER_NUMBER, MAX_DEEP_MODEL, resolveToken, getBrasiliaNow, formatMes } from "../config";

async function buildSnapshot(dias: number) {
  const now = getBrasiliaNow();
  const desde = new Date(now);
  desde.setDate(desde.getDate() - dias);
  const mesAtual = formatMes(now);

  const [transacoesPeriodo, transacoesMes, dividas, contasProximas, receitasPendentes, lembretes, tarefas, metas] = await Promise.all([
    prisma.transacao.findMany({ where: { data_transacao: { gte: desde } }, orderBy: { data_transacao: "desc" } }),
    prisma.transacao.findMany({ where: { mes: mesAtual } }),
    prisma.dividaMax.findMany({ where: { status: "ativa" } }),
    prisma.contaPagarMax.findMany({ where: { status: "pendente" }, orderBy: { data_vencimento: "asc" }, take: 10 }),
    prisma.receitaPrevistaMax.findMany({ where: { status: { in: ["pendente", "atrasada"] } } }),
    prisma.lembreteMax.findMany({ where: { enviado: false }, orderBy: { data_hora: "asc" }, take: 5 }),
    prisma.tarefaMax.findMany({ where: { status: "ativa" } }),
    prisma.metaFinanceiraMax.findMany({ where: { status: "ativa" } }),
  ]);

  const receitasMes = transacoesMes.filter(t => t.tipo === "receita").reduce((s, t) => s + t.valor, 0);
  const despesasMes = transacoesMes.filter(t => t.tipo === "despesa").reduce((s, t) => s + t.valor, 0);
  const saldoMes = receitasMes - despesasMes;

  const receitasPeriodo = transacoesPeriodo.filter(t => t.tipo === "receita").reduce((s, t) => s + t.valor, 0);
  const despesasPeriodo = transacoesPeriodo.filter(t => t.tipo === "despesa").reduce((s, t) => s + t.valor, 0);

  const categoriasMap = new Map<string, number>();
  for (const t of transacoesMes.filter(t => t.tipo === "despesa")) {
    categoriasMap.set(t.categoria, (categoriasMap.get(t.categoria) ?? 0) + t.valor);
  }
  const topCategorias = [...categoriasMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

  return {
    text: [
      `Data: ${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
      `\nMÊS ATUAL: Receitas ${fmt(receitasMes)} | Despesas ${fmt(despesasMes)} | Saldo ${fmt(saldoMes)}`,
      `Últimos ${dias}d: Receitas ${fmt(receitasPeriodo)} | Despesas ${fmt(despesasPeriodo)}`,
      topCategorias.length > 0 ? `Top categorias: ${topCategorias.map(([c, v]) => `${c} ${fmt(v)}`).join(", ")}` : "",
      dividas.length > 0 ? `Dívidas ativas (${dividas.length}): ${dividas.map(d => `${d.descricao} ${fmt(d.valor_total - d.valor_pago)} restante`).join("; ")}` : "",
      contasProximas.length > 0 ? `Contas próximas: ${contasProximas.map(c => `${c.descricao} ${fmt(c.valor)} venc. ${new Date(c.data_vencimento).toLocaleDateString("pt-BR")}`).join("; ")}` : "",
      receitasPendentes.length > 0 ? `Receitas pendentes: ${receitasPendentes.map(r => `${r.descricao} ${fmt(r.valor)}`).join("; ")}` : "",
      lembretes.length > 0 ? `Lembretes: ${lembretes.map(l => l.descricao).join("; ")}` : "",
      tarefas.length > 0 ? `Tarefas: ${tarefas.map(t => t.descricao).join("; ")}` : "",
      metas.length > 0 ? `Metas: ${metas.map(m => `${m.descricao} ${fmt(m.valor_atual)}/${fmt(m.valor_alvo)}`).join("; ")}` : "",
    ].filter(Boolean).join("\n"),
    saldoMes,
    despesasMes,
    burnRate: dias > 0 ? despesasPeriodo / dias : 0,
  };
}

export async function enviarBriefingMatinal(): Promise<void> {
  const snapshot = await buildSnapshot(30);

  const result = await chatCompletion({
    model: MAX_DEEP_MODEL,
    messages: [
      {
        role: "system",
        content: "Você é Max, assistente financeiro do Pedro. Briefing matinal CURTO pra WhatsApp. Comece com 'Bom dia'. MÁXIMO 500 caracteres, no máximo 5 linhas. Sem markdown/asteriscos. Só o essencial: saldo do mês, 1 conta/receita urgente, e 1 ação do dia. Direto, sem enrolação.",
      },
      { role: "user", content: `Dados para o briefing de hoje:\n\n${snapshot.text}` },
    ],
    max_tokens: 220,
  });

  const msg = result.choices[0]?.message?.content ?? "Bom dia! Não consegui gerar o briefing hoje.";

  const provider = await getOwnerProvider();
  if (!provider) return;
  await sendWhatsAppMessage(provider.businessPhoneNumberId, MAX_OWNER_NUMBER, msg, resolveToken(provider.accessToken));
}

export async function enviarFechamentoDia(): Promise<void> {
  const snapshot = await buildSnapshot(1);

  const result = await chatCompletion({
    model: MAX_DEEP_MODEL,
    messages: [
      {
        role: "system",
        content: "Você é Max. Fechamento do dia CURTO pra WhatsApp. Comece com 'Fechamento do dia:'. MÁXIMO 350 caracteres, no máximo 3 linhas. Sem markdown. Só: receitas x despesas do dia, saldo, e 1 alerta se houver. Nada de parágrafos longos.",
      },
      { role: "user", content: `Dados do dia:\n\n${snapshot.text}` },
    ],
    max_tokens: 160,
  });

  const msg = result.choices[0]?.message?.content ?? "Fechamento do dia: sem dados suficientes.";

  const provider = await getOwnerProvider();
  if (!provider) return;
  await sendWhatsAppMessage(provider.businessPhoneNumberId, MAX_OWNER_NUMBER, msg, resolveToken(provider.accessToken));
}

export async function enviarAnaliseSemanal(): Promise<void> {
  const snapshot = await buildSnapshot(60);

  const result = await chatCompletion({
    model: MAX_DEEP_MODEL,
    messages: [
      {
        role: "system",
        content: "Você é Max. Análise semanal CURTA pra WhatsApp. MÁXIMO 900 caracteres. Sem markdown. Em tópicos rápidos: tendência (subindo/caindo), 1 categoria fora de controle, ritmo vs meta R$8k, 1 coisa pra CORTAR e 1 pra DOBRAR. Nada de parágrafos longos.",
      },
      { role: "user", content: `Dados (60 dias):\n\n${snapshot.text}` },
    ],
    max_tokens: 380,
  });

  const msg = result.choices[0]?.message?.content ?? "Análise semanal indisponível.";

  const provider = await getOwnerProvider();
  if (!provider) return;
  await sendWhatsAppMessage(provider.businessPhoneNumberId, MAX_OWNER_NUMBER, msg, resolveToken(provider.accessToken));
}

export async function enviarFechamentoMensal(): Promise<void> {
  const now = getBrasiliaNow();
  const mesAnterior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const mesAnteAnterior = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const mesAnteriorStr = formatMes(mesAnterior);
  const mesAnteAnteriorStr = formatMes(mesAnteAnterior);

  const [tMesAnt, tMesAnteAnt, dividas, metas] = await Promise.all([
    prisma.transacao.findMany({ where: { mes: mesAnteriorStr } }),
    prisma.transacao.findMany({ where: { mes: mesAnteAnteriorStr } }),
    prisma.dividaMax.findMany({ where: { status: "ativa" } }),
    prisma.metaFinanceiraMax.findMany({ where: { status: "ativa" } }),
  ]);

  const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
  const resumo = (txs: typeof tMesAnt) => {
    const r = txs.filter(t => t.tipo === "receita").reduce((s, t) => s + t.valor, 0);
    const d = txs.filter(t => t.tipo === "despesa").reduce((s, t) => s + t.valor, 0);
    return { receitas: r, despesas: d, saldo: r - d };
  };

  const ant = resumo(tMesAnt);
  const anteAnt = resumo(tMesAnteAnt);

  const snapshot = [
    `Mês ${mesAnteriorStr}: Receitas ${fmt(ant.receitas)} | Despesas ${fmt(ant.despesas)} | Saldo ${fmt(ant.saldo)}`,
    `Mês ${mesAnteAnteriorStr}: Receitas ${fmt(anteAnt.receitas)} | Despesas ${fmt(anteAnt.despesas)} | Saldo ${fmt(anteAnt.saldo)}`,
    dividas.length > 0 ? `Dívidas: ${dividas.map(d => `${d.descricao} ${fmt(d.valor_total - d.valor_pago)} restante`).join("; ")}` : "",
    metas.length > 0 ? `Metas: ${metas.map(m => `${m.descricao} ${fmt(m.valor_atual)}/${fmt(m.valor_alvo)}`).join("; ")}` : "",
  ].filter(Boolean).join("\n");

  const result = await chatCompletion({
    model: MAX_DEEP_MODEL,
    messages: [
      {
        role: "system",
        content: "Você é Max. Fechamento mensal CURTO pra WhatsApp. MÁXIMO 1000 caracteres. Sem markdown. Compare mês anterior vs o de antes em poucas linhas: receitas×despesas, o que subiu/caiu, gap vs meta R$8k. Termine com nota 0-10 e 3 prioridades. Direto.",
      },
      { role: "user", content: snapshot },
    ],
    max_tokens: 420,
  });

  const msg = result.choices[0]?.message?.content ?? "Fechamento mensal indisponível.";

  const provider = await getOwnerProvider();
  if (!provider) return;
  await sendWhatsAppMessage(provider.businessPhoneNumberId, MAX_OWNER_NUMBER, msg, resolveToken(provider.accessToken));
}
