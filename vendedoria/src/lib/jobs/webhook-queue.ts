// ─── Reprocessamento da fila de webhooks ────────────────────────────────────
//
// Quando o webhook do WhatsApp falha (pool do banco esgotado, timeout do LLM,
// erro transitório), o payload é salvo em WebhookQueue e devolvemos 200 pra
// Meta — ela para de reenviar. Se ninguém reprocessar essa fila, a mensagem
// daquele cliente NUNCA é respondida.
//
// O plano da Vercel é Hobby: no máximo 2 cron jobs, com granularidade diária.
// Os dois já estão ocupados (disparo-diario, daily-summary) e "1x por dia" é
// lento demais pra um cliente esperando resposta. Por isso o dreno roda de
// forma oportunista, carregado pelo próprio tráfego: toda mensagem recebida
// aciona um dreno em after(), fora do caminho da resposta pra Meta.
//
// Concorrência: várias invocações podem drenar ao mesmo tempo. O claim é
// atômico (UPDATE ... FOR UPDATE SKIP LOCKED), então cada item é processado
// por exatamente uma invocação — nunca duas respostas pro mesmo cliente.

import { prisma } from "@/lib/prisma/client";
import { createHmac } from "crypto";

const MAX_ATTEMPTS = 5;

// Header que marca uma requisição como retry — o webhook usa isso pra não
// disparar outro dreno e entrar em recursão infinita.
export const RETRY_HEADER = "x-nexo-webhook-retry";

type ClaimedItem = {
  id: string;
  payload: string;
  attempts: number;
};

/**
 * Reprocessa webhooks que falharam. Fail-safe: nunca lança — é chamado de
 * dentro de after() no caminho de atendimento e não pode derrubar nada.
 *
 * @param limit quantos itens no máximo processar nesta passada
 */
export async function drainWebhookQueue(limit = 5): Promise<{
  retried: number;
  requeued: number;
  dropped: number;
}> {
  const result = { retried: 0, requeued: 0, dropped: 0 };

  try {
    // Marca itens vencidos como FAILED antes de tentar de novo — evita ficar
    // reprocessando pra sempre um payload que sempre quebra.
    await prisma.webhookQueue.updateMany({
      where: { status: "PENDING", attempts: { gte: MAX_ATTEMPTS } },
      data: { status: "FAILED" },
    });

    // Claim atômico: SKIP LOCKED faz cada invocação concorrente pegar um
    // conjunto disjunto de itens, sem bloquear as outras.
    const claimed = await prisma.$queryRaw<ClaimedItem[]>`
      UPDATE "WebhookQueue"
         SET status = 'PROCESSING', attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM "WebhookQueue"
          WHERE status = 'PENDING'
            AND "retryAfter" <= NOW()
            AND attempts < ${MAX_ATTEMPTS}
          ORDER BY "createdAt" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id, payload, attempts
    `;

    if (claimed.length === 0) return result;

    const baseUrl = process.env.NEXTAUTH_URL;
    const secret = process.env.META_WHATSAPP_APP_SECRET;
    if (!baseUrl || !secret) {
      console.error("[WebhookQueue] NEXTAUTH_URL ou META_WHATSAPP_APP_SECRET ausente — devolvendo itens à fila");
      await prisma.webhookQueue.updateMany({
        where: { id: { in: claimed.map((c) => c.id) } },
        data: { status: "PENDING" },
      });
      return result;
    }

    for (const item of claimed) {
      try {
        const sig = "sha256=" + createHmac("sha256", secret).update(item.payload).digest("hex");
        const res = await fetch(`${baseUrl}/api/webhooks/whatsapp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-hub-signature-256": sig,
            [RETRY_HEADER]: "1",
          },
          body: item.payload,
        });

        const json = res.ok
          ? await res.json().catch(() => ({}) as { queued?: boolean })
          : ({} as { queued?: boolean });

        if (res.ok && !json.queued) {
          await prisma.webhookQueue.update({
            where: { id: item.id },
            data: { status: "PROCESSED", error: null },
          });
          result.retried++;
        } else {
          // Falhou de novo — volta pra fila com backoff exponencial
          const backoff = Math.min(600_000, 30_000 * 2 ** item.attempts);
          await prisma.webhookQueue.update({
            where: { id: item.id },
            data: {
              status: item.attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
              retryAfter: new Date(Date.now() + backoff),
              error: res.ok ? "reenfileirado pelo webhook" : `HTTP ${res.status}`,
            },
          });
          if (item.attempts >= MAX_ATTEMPTS) result.dropped++;
          else result.requeued++;
        }
      } catch (err) {
        const backoff = Math.min(600_000, 30_000 * 2 ** item.attempts);
        await prisma.webhookQueue.update({
          where: { id: item.id },
          data: {
            status: item.attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
            retryAfter: new Date(Date.now() + backoff),
            error: String(err),
          },
        }).catch(() => {});
        if (item.attempts >= MAX_ATTEMPTS) result.dropped++;
        else result.requeued++;
      }
    }

    if (result.retried > 0 || result.dropped > 0) {
      console.log(
        `[WebhookQueue] reprocessados=${result.retried} reenfileirados=${result.requeued} descartados=${result.dropped}`,
      );
    }
  } catch (e) {
    console.error("[WebhookQueue] Erro ao drenar fila:", e);
  }

  return result;
}

/** Quantos webhooks estão parados na fila esperando reprocessamento. */
export async function countPendingWebhooks(): Promise<number> {
  return prisma.webhookQueue.count({ where: { status: "PENDING" } }).catch(() => 0);
}

/**
 * Dispara o processamento de follow-ups vencidos, se houver algum.
 *
 * Mesmo motivo do dreno da fila: com 2 crons diários no plano Hobby (ambos já
 * ocupados), o follow-up nunca rodaria. Aqui o tráfego de mensagens carrega o
 * agendamento — no caso comum (nada vencido) o custo é só um COUNT barato.
 *
 * O trabalho em si roda no /api/cron/followup, que já tem claim atômico por
 * lease: acionar em paralelo com o cron não gera follow-up duplicado.
 */
export async function triggerDueFollowups(): Promise<boolean> {
  try {
    const dueCount = await prisma.conversationFollowUp.count({
      where: { status: "ACTIVE", nextSendAt: { lte: new Date() } },
    });
    if (dueCount === 0) return false;

    const baseUrl = process.env.NEXTAUTH_URL;
    const secret = process.env.CRON_SECRET;
    if (!baseUrl || !secret) return false;

    console.log(`[FollowUp] ${dueCount} follow-up(s) vencido(s) — acionando processamento`);
    const res = await fetch(`${baseUrl}/api/cron/followup`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    return res.ok;
  } catch (e) {
    console.error("[FollowUp] Erro ao acionar follow-ups:", e);
    return false;
  }
}
