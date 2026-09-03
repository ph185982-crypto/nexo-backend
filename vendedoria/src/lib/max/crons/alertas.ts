import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { getOwnerProvider, MAX_OWNER_NUMBER, resolveToken, getBrasiliaNow, formatMes } from "../config";

async function tryAlert(chave: string): Promise<boolean> {
  try {
    await prisma.alertaEnviadoMax.create({ data: { chave } });
    return true;
  } catch {
    return false;
  }
}

export async function dispatchAlertas(): Promise<number> {
  const now = getBrasiliaNow();
  const hoje = now.toISOString().slice(0, 10);
  const amanha = new Date(now);
  amanha.setDate(amanha.getDate() + 1);
  const amanhaStr = amanha.toISOString().slice(0, 10);
  const em2dias = new Date(now);
  em2dias.setDate(em2dias.getDate() + 2);
  const em2diasStr = em2dias.toISOString().slice(0, 10);
  const mesAtual = formatMes(now);

  const alertas: string[] = [];

  const contasPendentes = await prisma.contaPagarMax.findMany({
    where: { status: "pendente" },
  });

  for (const c of contasPendentes) {
    const venc = c.data_vencimento.toISOString().slice(0, 10);
    if (venc === hoje) {
      if (await tryAlert(`conta-vencendo-${c.id}-${hoje}`)) {
        alertas.push(`💰 Conta vence HOJE: ${c.descricao} — R$ ${c.valor.toFixed(2).replace(".", ",")}`);
      }
    } else if (venc < hoje) {
      if (await tryAlert(`conta-atrasada-${c.id}-${hoje}`)) {
        alertas.push(`🚨 Conta ATRASADA: ${c.descricao} — R$ ${c.valor.toFixed(2).replace(".", ",")} (venc. ${new Date(c.data_vencimento).toLocaleDateString("pt-BR")})`);
      }
    } else if (venc === amanhaStr || venc === em2diasStr) {
      if (await tryAlert(`conta-proxima-${c.id}-${hoje}`)) {
        alertas.push(`📅 Conta em breve: ${c.descricao} — R$ ${c.valor.toFixed(2).replace(".", ",")} (${venc === amanhaStr ? "amanhã" : "em 2 dias"})`);
      }
    }
  }

  const dividas = await prisma.dividaMax.findMany({
    where: { status: "ativa", dia_vencimento: { not: null } },
  });

  for (const d of dividas) {
    if (d.dia_vencimento === now.getDate()) {
      if (await tryAlert(`divida-vencendo-${d.id}-${hoje}`)) {
        alertas.push(`🏦 Dívida vence HOJE: ${d.descricao} (${d.credor ?? ""}) — parcela R$ ${(d.parcela_mensal ?? 0).toFixed(2).replace(".", ",")}`);
      }
    } else if (d.dia_vencimento === amanha.getDate()) {
      if (await tryAlert(`divida-amanha-${d.id}-${hoje}`)) {
        alertas.push(`🏦 Dívida vence amanhã: ${d.descricao} (${d.credor ?? ""})`);
      }
    }
  }

  const receitas = await prisma.receitaPrevistaMax.findMany({
    where: { status: "pendente" },
  });

  for (const r of receitas) {
    const prev = r.data_prevista.toISOString().slice(0, 10);
    if (prev < hoje) {
      if (await tryAlert(`receita-atrasada-${r.id}-${hoje}`)) {
        alertas.push(`⏳ Receita ATRASADA: ${r.descricao} — R$ ${r.valor.toFixed(2).replace(".", ",")} (prevista ${new Date(r.data_prevista).toLocaleDateString("pt-BR")})`);
      }
    }
  }

  const orcamentos = await prisma.orcamentoMax.findMany();
  if (orcamentos.length > 0) {
    const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1);
    const fimMes = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    for (const orc of orcamentos) {
      const gastos = await prisma.transacao.aggregate({
        where: {
          tipo: "despesa",
          categoria: orc.categoria,
          data_transacao: { gte: inicioMes, lte: fimMes },
        },
        _sum: { valor: true },
      });

      const gasto = gastos._sum.valor ?? 0;
      const pct = orc.limite_mensal > 0 ? (gasto / orc.limite_mensal) * 100 : 0;

      if (pct >= 100) {
        if (await tryAlert(`orc-estourado-${orc.categoria}-${mesAtual}`)) {
          alertas.push(`🔴 Orçamento ESTOURADO: ${orc.categoria} — R$ ${gasto.toFixed(2).replace(".", ",")} / R$ ${orc.limite_mensal.toFixed(2).replace(".", ",")} (${pct.toFixed(0)}%)`);
        }
      } else if (pct >= 80) {
        if (await tryAlert(`orc-80-${orc.categoria}-${mesAtual}`)) {
          alertas.push(`🟡 Orçamento em alerta: ${orc.categoria} — ${pct.toFixed(0)}% usado (R$ ${gasto.toFixed(2).replace(".", ",")} / R$ ${orc.limite_mensal.toFixed(2).replace(".", ",")})`);
        }
      }
    }
  }

  if (alertas.length === 0) return 0;

  const provider = await getOwnerProvider();
  if (!provider) return 0;
  const token = resolveToken(provider.accessToken);

  const msg = `🔔 Max de olho:\n\n${alertas.join("\n\n")}`;
  await sendWhatsAppMessage(provider.businessPhoneNumberId, MAX_OWNER_NUMBER, msg, token);

  return alertas.length;
}
