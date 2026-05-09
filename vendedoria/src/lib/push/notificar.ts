import webpush from "web-push";
import { prisma } from "@/lib/prisma/client";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

function initWebPush(): boolean {
  const email = process.env.VAPID_EMAIL;
  const pub   = process.env.VAPID_PUBLIC_KEY;
  const priv  = process.env.VAPID_PRIVATE_KEY;
  if (!email || !pub || !priv) return false;
  webpush.setVapidDetails(email, pub, priv);
  return true;
}

async function dispatchToSubs(
  subs: Array<{ endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload,
): Promise<void> {
  if (!subs.length) return;
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
      } catch (err: unknown) {
        const code = (err as { statusCode?: number }).statusCode;
        const msg  = (err as Error).message ?? "";
        const dead = code === 410 || code === 404 || msg.includes("p256dh") || msg.includes("Valid subscription");
        if (dead) {
          await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
        } else {
          console.error("[push] Erro ao enviar:", err);
        }
      }
    }),
  );
}

// ── Send to every registered device ──────────────────────────────────────────
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  if (!initWebPush()) {
    console.warn("[push] VAPID não configurado — ignorado");
    return;
  }
  const subs = await prisma.pushSubscription.findMany();
  await dispatchToSubs(subs, payload);
}

// ── Send only to ADMIN users (role = ADMIN) ───────────────────────────────────
export async function sendPushToAdmins(payload: PushPayload): Promise<void> {
  if (!initWebPush()) return;
  const subs = await prisma.pushSubscription.findMany({
    where: {
      OR: [
        { userId: null },                           // subscriptions without session (legacy)
        { user: { role: "ADMIN" } },
      ],
    },
  });
  await dispatchToSubs(subs, payload);
}

// ── Named notification helpers ────────────────────────────────────────────────

export async function notificarNovaMensagem(
  nomeCliente: string,
  preview: string,
  conversationId: string,
): Promise<void> {
  await sendPushToAll({
    title: `💬 ${nomeCliente}`,
    body:  preview.substring(0, 120),
    url:   `/crm/conversations?id=${conversationId}`,
    tag:   `conv-${conversationId}`,
  });
}

export async function notificarPassagem(opts: {
  nomeCliente: string;
  produto: string;
  endereco: string;
  pagamento: string;
  conversationId: string;
}): Promise<void> {
  await sendPushToAdmins({
    title: `🔔 Pedido Novo — ${opts.nomeCliente}`,
    body:  `📦 ${opts.produto} | 🏠 ${opts.endereco.substring(0, 60)} | 💳 ${opts.pagamento}`,
    url:   `/crm/conversations?id=${opts.conversationId}`,
    tag:   `passagem-${opts.conversationId}`,
  });
}

export async function notificarLeadQuente(opts: {
  nomeCliente: string;
  mensagem: string;
  conversationId: string;
}): Promise<void> {
  await sendPushToAdmins({
    title: `🔥 Lead Quente — ${opts.nomeCliente}`,
    body:  opts.mensagem.substring(0, 120),
    url:   `/crm/conversations?id=${opts.conversationId}`,
    tag:   `quente-${opts.conversationId}`,
  });
}

export async function notificarEscalacao(opts: {
  nomeCliente: string;
  motivo: string;
  conversationId: string;
}): Promise<void> {
  await sendPushToAdmins({
    title: `⚡ Escalação — ${opts.nomeCliente}`,
    body:  opts.motivo.substring(0, 120),
    url:   `/crm/conversations?id=${opts.conversationId}`,
    tag:   `esc-${opts.conversationId}`,
  });
}
