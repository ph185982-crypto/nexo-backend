// Limites mensais de gasto definidos em 04/11/2026 a partir do histórico de setembro e
// outubro do dono (despesas pessoais), com folga pequena para forçar equilíbrio sem
// travar o mês. Entram UMA vez só (marca em AlertaEnviadoMax) e passam pelo livro-razão;
// o dono ajusta ou apaga qualquer um na aba Orçamentos, e o que ele apagar não volta.
// Fatura de cartão e parcelas de contrato ficam de fora de propósito: são fixas.

import { prisma } from "@/lib/prisma/client";
import { chaveCategoria } from "./dre";

const MARCA = "seed-orcamentos-v1";

export const ORCAMENTOS_INICIAIS: Array<{ categoria: string; limite_mensal: number; base: string }> = [
  { categoria: "Alimentação", limite_mensal: 600, base: "média de R$ 589 (set R$ 738, out R$ 440)" },
  { categoria: "Transporte", limite_mensal: 550, base: "média de R$ 473 (set R$ 346, out R$ 601)" },
  { categoria: "Cartão de crédito", limite_mensal: 1000, base: "out R$ 1.165 em cartões: meta de baixar a fatura nova" },
  { categoria: "Lazer", limite_mensal: 150, base: "set R$ 48" },
  { categoria: "Vestuário", limite_mensal: 200, base: "set R$ 115, out R$ 190" },
  { categoria: "Saúde", limite_mensal: 250, base: "set R$ 192" },
  { categoria: "Outros", limite_mensal: 600, base: "set R$ 2.193 e out R$ 923: o que mais escapa do controle" },
];

export async function semearOrcamentosIniciais(): Promise<{ criados: number }> {
  try {
    await prisma.alertaEnviadoMax.create({ data: { chave: MARCA } });
  } catch {
    return { criados: 0 };
  }
  let criados = 0;
  try {
    const existentes = (await prisma.orcamentoMax.findMany({ select: { categoria: true } })).map((o) => chaveCategoria(o.categoria));
    for (const o of ORCAMENTOS_INICIAIS) {
      if (existentes.includes(chaveCategoria(o.categoria))) continue; // o dono já definiu
      await prisma.orcamentoMax.create({ data: { categoria: o.categoria, limite_mensal: o.limite_mensal } });
      criados++;
    }
  } catch (e) {
    await prisma.alertaEnviadoMax.deleteMany({ where: { chave: MARCA } }).catch(() => {});
    throw e;
  }
  return { criados };
}
