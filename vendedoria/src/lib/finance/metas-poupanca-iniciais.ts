// Meta de poupança combinada com o dono em 16/11/2026: guardar R$ 28.000 até maio de
// 2027, com R$ 1.000 já guardados, e o Max cobrando R$ 63 por dia. Entra UMA vez só
// (marca em AlertaEnviadoMax) e passa pelo livro-razão; o dono ajusta o valor diário,
// o prazo ou o alvo na tela (Financeiro → Visão Geral) ou pelo Max, e se apagar não volta.

import { prisma } from "@/lib/prisma/client";
import { TIPO_POUPANCA, registrarAporte } from "./metas-poupanca";

const MARCA = "seed-meta-poupanca-28k-v1";

export const META_INICIAL = {
  descricao: "Reserva — R$ 28 mil até maio/2027",
  valor_alvo: 28000,
  aporte_diario: 63,
  ja_guardado: 1000,
  data_inicio: "2026-11-16",
  data_fim: "2027-05-31",
  // Chave Pix (aleatória) da conta da reserva, informada pelo dono em 16/11/2026.
  chave_pix: "d57d1fc1-c6cc-4ce9-bf6c-6bdce974b687",
} as const;

const MARCA_PIX = "seed-meta-poupanca-pix-v1";

export async function semearMetaPoupancaInicial(): Promise<{ criada: boolean }> {
  try {
    await prisma.alertaEnviadoMax.create({ data: { chave: MARCA } });
  } catch {
    return { criada: false };
  }
  try {
    const meta = await prisma.metaFinanceiraMax.create({
      data: {
        descricao: META_INICIAL.descricao,
        valor_alvo: META_INICIAL.valor_alvo,
        valor_atual: 0,
        tipo: TIPO_POUPANCA,
        tipo_negocio: "pessoal",
        data_inicio: new Date(`${META_INICIAL.data_inicio}T00:00:00Z`),
        data_fim: new Date(`${META_INICIAL.data_fim}T00:00:00Z`),
        aporte_diario: META_INICIAL.aporte_diario,
        cobrar_diariamente: true,
        chave_pix: META_INICIAL.chave_pix,
      },
    });
    await registrarAporte({
      metaId: meta.id,
      valor: META_INICIAL.ja_guardado,
      data: new Date(`${META_INICIAL.data_inicio}T00:00:00Z`),
      origem: "inicial",
      observacao: "Saldo que já estava guardado ao criar a meta",
    });
    return { criada: true };
  } catch (e) {
    await prisma.alertaEnviadoMax.deleteMany({ where: { chave: MARCA } }).catch(() => {});
    throw e;
  }
}

/**
 * A meta já existia em produção antes da chave Pix: grava a chave nela uma única vez
 * (só se estiver vazia — se o dono trocou a chave, fica a dele).
 */
export async function aplicarPixMetaInicial(): Promise<{ aplicada: boolean }> {
  try {
    await prisma.alertaEnviadoMax.create({ data: { chave: MARCA_PIX } });
  } catch {
    return { aplicada: false };
  }
  try {
    const r = await prisma.metaFinanceiraMax.updateMany({
      where: { tipo: TIPO_POUPANCA, descricao: META_INICIAL.descricao, chave_pix: null },
      data: { chave_pix: META_INICIAL.chave_pix },
    });
    return { aplicada: r.count > 0 };
  } catch (e) {
    await prisma.alertaEnviadoMax.deleteMany({ where: { chave: MARCA_PIX } }).catch(() => {});
    throw e;
  }
}

/** Seed da meta + chave Pix, na ordem certa. */
export async function semearPoupancaInicial(): Promise<void> {
  await semearMetaPoupancaInicial();
  await aplicarPixMetaInicial();
}
