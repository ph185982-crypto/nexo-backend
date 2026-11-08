// Ciclo de vida da entrega: concluir quando todos os cartões terminam e reabrir se um cartão volta.
import { prisma } from "@/lib/prisma";

/**
 * Marca a entrega como concluída (se estava em andamento) e dispara o gatilho "Entrega concluída".
 * Idempotente: só a primeira chamada conclui. Devolve se concluiu agora.
 */
export async function concluirEntrega(entregaId: string, agora: Date = new Date()): Promise<boolean> {
  const r = await prisma.entrega.updateMany({ where: { id: entregaId, status: "EM_ANDAMENTO" }, data: { status: "CONCLUIDA", concluidaEm: agora } });
  if (r.count === 0) return false;
  const { dispararEventoEntrega } = await import("@/lib/automacao/motor");
  await dispararEventoEntrega("ENTREGA_CONCLUIDA", entregaId, null, agora);
  return true;
}

/** Entrega concluída que ganhou trabalho de novo (cartão saiu de "Concluído") volta a ficar em andamento. */
export async function reabrirEntrega(entregaId: string): Promise<boolean> {
  const r = await prisma.entrega.updateMany({ where: { id: entregaId, status: "CONCLUIDA" }, data: { status: "EM_ANDAMENTO", concluidaEm: null } });
  return r.count > 0;
}

/** Depois de um cartão mudar de coluna: dispara "cartão concluído" e conclui ou reabre a entrega. */
export async function depoisDeMoverCartao(cartaoId: string, de: string, para: string, agora: Date = new Date()): Promise<void> {
  if (de === para) return;
  const c = await prisma.entregaCartao.findUnique({ where: { id: cartaoId }, select: { entregaId: true } });
  if (!c) return;
  // O combinado ligado ao cartão acompanha (entregue / pendente de novo).
  if (para === "CONCLUIDO") await prisma.combinado.updateMany({ where: { cartaoId, status: "PENDENTE" }, data: { status: "ENTREGUE", entregueEm: agora } });
  else if (de === "CONCLUIDO") await prisma.combinado.updateMany({ where: { cartaoId, status: "ENTREGUE" }, data: { status: "PENDENTE", entregueEm: null } });
  if (para === "CONCLUIDO") {
    const { dispararEventoEntrega } = await import("@/lib/automacao/motor");
    await dispararEventoEntrega("ENTREGA_CARTAO_CONCLUIDO", c.entregaId, cartaoId, agora);
    const abertos = await prisma.entregaCartao.count({ where: { entregaId: c.entregaId, coluna: { not: "CONCLUIDO" } } });
    if (abertos === 0) await concluirEntrega(c.entregaId, agora);
  } else if (de === "CONCLUIDO") {
    await reabrirEntrega(c.entregaId);
  }
}
