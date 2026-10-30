// Quando a OpenAI (ou outro provedor) recusa por falta de crédito, o lead
// recebe "tive um probleminha" e o dono só descobria olhando os logs da Vercel
// (que ficam 1h no plano Hobby). Em 26/10 isso derrubou 2 atendimentos.
// Agora vira notificação + push, uma vez a cada 6h por provedor.
import { prisma } from "@/lib/prisma/client";

const COTA = /insufficient_quota|credit_balance_exhausted|no credits remaining|billing_hard_limit|exceeded your current quota/i;
const INTERVALO_MS = 6 * 60 * 60 * 1000;

export function ehErroDeCota(texto: string): boolean {
  return COTA.test(texto);
}

export async function alertarCotaEsgotada(provedor: string, detalhe: string): Promise<void> {
  const titulo = `💳 ${provedor} sem créditos — a IA parou de responder`;
  try {
    const recente = await prisma.ownerNotification.findFirst({
      where: { title: titulo, createdAt: { gte: new Date(Date.now() - INTERVALO_MS) } },
      select: { id: true },
    });
    if (recente) return;
    const org = await prisma.whatsappBusinessOrganization.findFirst({ select: { id: true } });
    if (!org) return;
    await prisma.ownerNotification.create({
      data: {
        type: "ESCALATION",
        title: titulo,
        body: `O provedor ${provedor} recusou a chamada por falta de crédito. Leads estão recebendo a mensagem de espera. ` +
          `Adicione créditos (OpenAI: platform.openai.com → Billing) e ative a recarga automática.\n\nDetalhe: ${detalhe.slice(0, 300)}`,
        organizationId: org.id,
      },
    });
    const { sendPushToAll } = await import("@/lib/push/notificar");
    await sendPushToAll({ title: titulo, body: "Adicione créditos para a IA voltar a responder.", url: "/crm/settings", tag: `cota-${provedor}` }).catch(() => {});
  } catch (e) {
    console.error("[AlertaCota] falhou:", e);
  }
}
