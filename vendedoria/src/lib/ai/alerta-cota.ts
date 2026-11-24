// Quando a OpenAI (ou outro provedor) recusa por falta de crédito, o lead
// recebe "tive um probleminha" e o dono só descobria olhando os logs da Vercel
// (que ficam 1h no plano Hobby). Em 26/10 isso derrubou 2 atendimentos.
// Agora vira notificação + push, uma vez a cada 6h por provedor.
import { prisma } from "@/lib/prisma/client";
import { textoAlertaCota } from "./alerta-cota-texto";
export { textoAlertaCota };

const COTA = /insufficient_quota|credit_balance_exhausted|no credits remaining|billing_hard_limit|exceeded your current quota|insufficient balance/i;
const INTERVALO_MS = 6 * 60 * 60 * 1000;
const INTERVALO_COM_RESERVA_MS = 24 * 60 * 60 * 1000;

export function ehErroDeCota(texto: string): boolean {
  return COTA.test(texto);
}

export async function alertarCotaEsgotada(provedor: string, detalhe: string): Promise<void> {
  const temReserva = provedor === "DeepSeek" && Boolean(process.env.OPENAI_API_KEY);
  const { titulo, corpo } = textoAlertaCota(provedor, detalhe, temReserva);
  try {
    const recente = await prisma.ownerNotification.findFirst({
      where: { title: titulo, createdAt: { gte: new Date(Date.now() - (temReserva ? INTERVALO_COM_RESERVA_MS : INTERVALO_MS)) } },
      select: { id: true },
    });
    if (recente) return;
    const org = await prisma.whatsappBusinessOrganization.findFirst({ select: { id: true } });
    if (!org) return;
    // INFO (não ESCALATION): é um aviso de operação, não um lead escalado — assim nunca entra na fila de bastões do WhatsApp.
    await prisma.ownerNotification.create({ data: { type: "INFO", title: titulo, body: corpo, organizationId: org.id } });
    const { sendPushToAll } = await import("@/lib/push/notificar");
    await sendPushToAll({ title: titulo, body: temReserva ? "Os atendimentos seguem pela OpenAI; recarregue a DeepSeek para economizar." : "Adicione créditos para a IA voltar a responder.", url: "/crm/settings", tag: `cota-${provedor}` }).catch(() => {});
  } catch (e) {
    console.error("[AlertaCota] falhou:", e);
  }
}
