import webpush from "web-push";
import { prisma } from "@/lib/prisma/client";

function initWebPush() {
  const email = process.env.VAPID_EMAIL;
  const pub   = process.env.VAPID_PUBLIC_KEY;
  const priv  = process.env.VAPID_PRIVATE_KEY;
  if (!email || !pub || !priv) return false;
  webpush.setVapidDetails(email, pub, priv);
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export async function sendPushToAll(payload: PushPayload): Promise<void> {
  if (!initWebPush()) {
    console.warn("[push] VAPID não configurado — notificação ignorada");
    return;
  }

  const subscriptions = await prisma.pushSubscription.findMany();
  if (subscriptions.length === 0) return;

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        const errMsg = (err as Error).message ?? "";
        const isInvalidKey =
          errMsg.includes("p256dh") ||
          errMsg.includes("auth") && errMsg.includes("bytes") ||
          errMsg.includes("Valid subscription");
        if (statusCode === 410 || statusCode === 404 || isInvalidKey) {
          // Subscription expired or malformed — remove it so future pushes don't spam the log
          await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
          console.log(`[push] Subscription removida (${statusCode ?? "invalid-key"}): ${sub.endpoint.slice(0, 60)}`);
        } else {
          console.error("[push] Erro ao enviar:", err);
        }
      }
    })
  );
}

export async function notificarNovaMensagem(
  nomeCliente: string,
  preview: string,
  conversationId: string
): Promise<void> {
  await sendPushToAll({
    title: `💬 ${nomeCliente}`,
    body: preview.substring(0, 120),
    url: `/crm/conversations?id=${conversationId}`,
    tag: `conv-${conversationId}`,
  });
}
