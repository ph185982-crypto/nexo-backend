// Limites mensais de gasto por categoria. O extrato tem a mesma categoria escrita de
// jeitos diferentes ("Cartão de crédito", "Cartão de crédito " com espaço, "Cartão de
// credito"), então o gasto é somado pela chave normalizada.

import { prisma } from "@/lib/prisma/client";
import { chaveCategoria } from "./dre";

/** Gasto do mês (despesas do extrato) somado por categoria normalizada. */
export async function gastoPorCategoriaNoMes(mes: string): Promise<Map<string, number>> {
  const rows = await prisma.transacao.groupBy({
    by: ["categoria"],
    where: { tipo: "despesa", mes },
    _sum: { valor: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const k = chaveCategoria(r.categoria);
    out.set(k, (out.get(k) ?? 0) + (r._sum.valor ?? 0));
  }
  return out;
}

export function gastoDaCategoria(mapa: Map<string, number>, categoria: string): number {
  return Math.round((mapa.get(chaveCategoria(categoria)) ?? 0) * 100) / 100;
}

export type NivelOrcamento = "ok" | "alerta" | "estourado";

/** 80% ou mais = alerta; 100% ou mais = estourado. */
export function nivelDoOrcamento(gasto: number, limite: number): NivelOrcamento {
  if (!(limite > 0)) return "ok";
  const pct = (gasto / limite) * 100;
  return pct >= 100 ? "estourado" : pct >= 80 ? "alerta" : "ok";
}
