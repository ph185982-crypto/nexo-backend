// Restauração de lançamentos excluídos a partir do livro-razão (HistoricoFinanceiro).
// A linha volta com o MESMO id e os mesmos dados de antes da exclusão.

import { prisma } from "@/lib/prisma/client";

export const MODELOS_RESTAURAVEIS = ["Transacao", "ReceitaPrevistaMax", "ContaPagarMax"] as const;
export type ModeloRestauravel = (typeof MODELOS_RESTAURAVEIS)[number];

// Campos de data de cada modelo (no JSON do histórico viram string ISO)
const CAMPOS_DATA: Record<ModeloRestauravel, string[]> = {
  Transacao: ["data_transacao", "criado_em"],
  ReceitaPrevistaMax: ["data_prevista", "data_recebimento", "data_perda", "criado_em"],
  ContaPagarMax: ["data_vencimento", "criado_em"],
};

export type ResultadoRestauracao =
  | { ok: true; entidade: string; entidade_id: string }
  | { ok: false; status: number; erro: string };

export async function restaurarDoHistorico(historicoId: string): Promise<ResultadoRestauracao> {
  const h = await prisma.historicoFinanceiro.findUnique({ where: { id: historicoId } });
  if (!h) return { ok: false, status: 404, erro: "Registro de histórico não encontrado." };
  if (h.acao !== "excluido" || !h.antes) {
    return { ok: false, status: 409, erro: "Só é possível restaurar lançamentos excluídos." };
  }
  if (!(MODELOS_RESTAURAVEIS as readonly string[]).includes(h.entidade)) {
    return { ok: false, status: 409, erro: `Restauração não disponível para ${h.entidade}.` };
  }
  const modelo = h.entidade as ModeloRestauravel;
  const dados = { ...(h.antes as Record<string, unknown>) };
  for (const campo of CAMPOS_DATA[modelo]) {
    if (typeof dados[campo] === "string") dados[campo] = new Date(dados[campo] as string);
  }

  const delegate = (prisma as unknown as Record<string, { findUnique: (a: unknown) => Promise<unknown>; create: (a: unknown) => Promise<unknown> }>)[
    modelo.charAt(0).toLowerCase() + modelo.slice(1)
  ];
  if (await delegate.findUnique({ where: { id: h.entidade_id } })) {
    return { ok: false, status: 409, erro: "Este lançamento já existe — nada a restaurar." };
  }
  try {
    await delegate.create({ data: dados });
  } catch (e) {
    console.error("[restaurar]", e);
    return { ok: false, status: 409, erro: "Não foi possível restaurar (conflito com outro lançamento)." };
  }
  return { ok: true, entidade: modelo, entidade_id: h.entidade_id };
}
