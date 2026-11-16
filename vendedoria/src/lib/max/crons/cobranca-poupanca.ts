// Cobrança diária da meta de poupança: todo dia o Max cobra o dono o valor combinado
// (ex.: R$ 63) para guardar na reserva, com o progresso e a projeção até o prazo.
//
//  • Manhã (a partir das 9h, Brasília): primeira cobrança do dia.
//  • Noite (20h–22h): lembrete só se o valor do dia ainda não foi guardado.
//  • Uma vez por meta, por dia e por período (AlertaEnviadoMax). Se já guardou o valor
//    do dia, não cobra. Se nenhum canal entregar, a trava é liberada.
//  • O dono responde "guardei 63" ao Max, que registra o aporte (gerenciar_meta_poupanca).

import { prisma } from "@/lib/prisma/client";
import { listarMetasPoupanca, resumoMeta, brl, type MetaPoupanca } from "@/lib/finance/metas-poupanca";
import { entregarPorTodosOsCanais, partesBrasilia, type Entregador, type EntregaVespera } from "./contas-vespera";

export const HORA_MANHA = 9;
export const HORA_NOITE = 20;
const HORA_FIM = 22;

export const chaveCobranca = (metaId: string, dia: string, periodo: "manha" | "noite") => `poupanca-${periodo}-${metaId}-${dia}`;

export function montarMensagemCobranca(m: MetaPoupanca, periodo: "manha" | "noite"): string {
  const p = m.projecao;
  const valorHoje = p.pendenteHoje;
  const abertura =
    periodo === "manha"
      ? `💰 Hora de guardar: ${brl(valorHoje)} hoje na ${m.descricao}.`
      : `🌙 Ainda faltam ${brl(valorHoje)} para guardar hoje na ${m.descricao}.`;
  const valorResposta = Number.isInteger(valorHoje) ? String(valorHoje) : valorHoje.toFixed(2).replace(".", ",");
  return `${abertura}\n\n${resumoMeta(m)}\n\nJá guardou? Me responda "guardei ${valorResposta}".`;
}

export interface ResultadoCobranca {
  situacao: "fora-do-horario" | "nada" | "cobrado" | "sem-canal";
  metas: number;
  entrega?: EntregaVespera;
}

export async function cobrarPoupancaDoDia(opts: { agora?: Date; entregar?: Entregador } = {}): Promise<ResultadoCobranca> {
  const agora = opts.agora ?? new Date();
  const { dia, hora } = partesBrasilia(agora);
  if (hora < HORA_MANHA || hora >= HORA_FIM) return { situacao: "fora-do-horario", metas: 0 };
  const periodo: "manha" | "noite" = hora >= HORA_NOITE ? "noite" : "manha";

  const metas = (await listarMetasPoupanca({ agora })).filter(
    (m) => m.cobrarDiariamente && m.aporteDiario > 0 && !m.projecao.concluida && m.projecao.pendenteHoje > 0 && m.dataInicio <= dia && dia <= m.dataFim,
  );
  if (metas.length === 0) return { situacao: "nada", metas: 0 };

  let cobradas = 0;
  let ultimaEntrega: EntregaVespera | undefined;
  let semCanal = false;
  for (const m of metas) {
    const chave = chaveCobranca(m.id, dia, periodo);
    try {
      await prisma.alertaEnviadoMax.create({ data: { chave } });
    } catch {
      continue; // já cobrado neste período
    }
    const entrega = await (opts.entregar ?? entregarPorTodosOsCanais)({
      titulo: periodo === "manha" ? `💰 Guardar ${brl(m.projecao.pendenteHoje)} hoje` : `🌙 Falta guardar ${brl(m.projecao.pendenteHoje)} hoje`,
      mensagem: montarMensagemCobranca(m, periodo),
      resumo: `${m.descricao}: ${brl(m.atual)} de ${brl(m.alvo)} (${m.projecao.pct}%)`,
      url: "/crm/financeiro",
      tag: "meta-poupanca",
    });
    ultimaEntrega = entrega;
    if (!entrega.whatsapp && !entrega.notificacao) {
      await prisma.alertaEnviadoMax.deleteMany({ where: { chave } }).catch(() => {});
      semCanal = true;
      continue;
    }
    cobradas++;
  }
  if (cobradas === 0) return semCanal ? { situacao: "sem-canal", metas: metas.length, entrega: ultimaEntrega } : { situacao: "nada", metas: 0 };
  console.log(`[Max] Cobrança da poupança enviada | periodo=${periodo} metas=${cobradas}`);
  return { situacao: "cobrado", metas: cobradas, entrega: ultimaEntrega };
}
