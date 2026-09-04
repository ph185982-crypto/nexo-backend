// Follow-up Queue — BullMQ + Redis
// Agenda follow-ups com delay preciso. Complementa o cron de polling.
// Se REDIS_URL não estiver disponível, cai silenciosamente para o modo cron.

import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { moverLeadPorTipo } from "@/lib/crm/pipeline-mover";

const QUEUE_NAME = "followup";

// ── Intervalos por step ────────────────────────────────────────────────────────
const STEP_INTERVALS_MS: Record<number, number> = {
  1: 4  * 60 * 60 * 1000,   // step 1 — 4h
  2: 24 * 60 * 60 * 1000,   // step 2 — 24h
  3: 48 * 60 * 60 * 1000,   // step 3 — 48h
  4: 72 * 60 * 60 * 1000,   // step 4 — 72h
};

// ── Mensagens por step (prospecção B2B — Nexo) ───────────────────────────────
function buildProspeccaoFollowupMessage(step: number, name: string | null): string[] {
  switch (step) {
    case 1: return [
      "oi! conseguiu ver minha mensagem?",
      "qualquer dúvida sobre como funciona a assessoria, é só perguntar 😊",
    ];
    case 2: return [
      "lembrei de você aqui",
      "essa semana ainda tenho horários abertos para o diagnóstico gratuito",
      "quer que eu veja um horário bom pra você?",
    ];
    case 3: return [
      "vou deixar a agenda aberta até sexta",
      "se quiser entender como aumentar as vendas nos marketplaces, me chama 👊",
    ];
    case 4: return [
      "tudo bem, não vou mais te incomodar 😄",
      name ? `se um dia fizer sentido, me chama — abraço, ${name}!` : "se um dia fizer sentido, me chama — abraço!",
    ];
    default: return [];
  }
}

// ── Mensagens por step ───────────────────────────────────────────────────────
function buildFollowupMessage(step: number, name: string | null): string[] {
  switch (step) {
    case 1: return [
      "oi! ficou alguma dúvida?",
      "pode perguntar à vontade 😊",
    ];
    case 2: return [
      "lembrei de você",
      "qualquer coisa que quiser saber é só chamar",
      "tô por aqui 👊",
    ];
    case 3: return [
      "ainda tenho unidades disponíveis",
      "mas o estoque tá acabando essa semana",
      "consegue fechar hoje?",
    ];
    case 4: return [
      "tudo bem, não vou mais te incomodar 😄",
      "se um dia precisar",
      name ? `pode me chamar que a gente resolve — abraço ${name}! 👊` : "pode me chamar que a gente resolve — abraço! 👊",
    ];
    default: return [];
  }
}

// ── Job payload ───────────────────────────────────────────────────────────────
export interface FollowUpJobData {
  followUpId: string;
  conversationId: string;
  step: number;
  phoneNumber: string;
  phoneNumberId: string;
  leadName: string | null;
  accessToken: string | null;
}

// ── Redis connection ───────────────────────────────────────────────────────────
let redisConnection: IORedis | null = null;
let followUpQueue: Queue<FollowUpJobData> | null = null;

function getRedisConnection(): IORedis | null {
  if (!process.env.REDIS_URL) return null;
  if (redisConnection) return redisConnection;

  try {
    redisConnection = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    redisConnection.on("error", (err: Error) => {
      console.warn("[FollowUpQueue] Redis error:", err.message);
    });

    return redisConnection;
  } catch (err) {
    console.warn("[FollowUpQueue] Redis connection failed:", err);
    return null;
  }
}

function getQueue(): Queue<FollowUpJobData> | null {
  if (followUpQueue) return followUpQueue;
  const conn = getRedisConnection();
  if (!conn) return null;

  followUpQueue = new Queue<FollowUpJobData>(QUEUE_NAME, {
    connection: conn,
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 200,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
    },
  });

  followUpQueue.on("error", (err: Error) => {
    console.error("[FollowUpQueue] Queue error:", err.message);
  });

  return followUpQueue;
}

// ── Enqueue: agenda um follow-up com delay calculado ──────────────────────────
export async function enqueueFollowUp(
  followUpId: string,
  conversationId: string,
  step: number,
  phoneNumber: string,
  phoneNumberId: string,
  leadName: string | null,
  accessToken: string | null,
  aiMessageAt: Date,
): Promise<boolean> {
  const queue = getQueue();
  if (!queue) {
    console.log("[FollowUpQueue] Redis indisponível — usando modo cron (fallback)");
    return false;
  }

  const intervalMs = STEP_INTERVALS_MS[step];
  if (!intervalMs) return false;

  const delay = Math.max(0, aiMessageAt.getTime() + intervalMs - Date.now());
  const jobId = `fu_${conversationId}_step${step}`;

  await queue.add(
    "send-followup",
    { followUpId, conversationId, step, phoneNumber, phoneNumberId, leadName, accessToken },
    { delay, jobId, deduplication: { id: jobId } },
  );

  console.log(`[FollowUpQueue] Enqueued step ${step} for conv ${conversationId} | delay ${Math.round(delay / 1000)}s`);
  return true;
}

// ── Cancel: remove jobs pendentes de uma conversa ────────────────────────────
export async function cancelFollowUpJobs(conversationId: string): Promise<void> {
  const queue = getQueue();
  if (!queue) return;

  for (let step = 1; step <= 4; step++) {
    const jobId = `fu_${conversationId}_step${step}`;
    const job = await queue.getJob(jobId).catch(() => null);
    if (job) {
      await job.remove().catch(() => {});
      console.log(`[FollowUpQueue] Cancelled step ${step} for conv ${conversationId}`);
    }
  }
}

/** Alias for cancelFollowUpJobs — used by the webhook route */
export const cancelFollowUpsForConversation = cancelFollowUpJobs;

// ── Worker: processa jobs de follow-up ───────────────────────────────────────
let workerStarted = false;

export function startFollowUpWorker(): void {
  if (workerStarted) return;

  const conn = getRedisConnection();
  if (!conn) {
    console.log("[FollowUpWorker] Redis indisponível — worker não iniciado (usando cron)");
    return;
  }

  const worker = new Worker<FollowUpJobData>(
    QUEUE_NAME,
    async (job: Job<FollowUpJobData>) => {
      const { followUpId, conversationId, step, phoneNumber, phoneNumberId, leadName, accessToken } = job.data;
      console.log(`[FollowUpWorker] Processing step ${step} for conv ${conversationId}`);

      // Verificar se o follow-up ainda está ativo no banco
      const fu = await prisma.conversationFollowUp.findUnique({ where: { id: followUpId } });
      if (!fu || fu.status !== "ACTIVE") {
        console.log(`[FollowUpWorker] Follow-up ${followUpId} não está mais ativo (status: ${fu?.status ?? "not found"}) — skip`);
        return;
      }

      // TASK 2: Verificar status do lead ANTES de enviar — nunca mandar follow-up para BLOCKED/CLOSED
      const conv = await prisma.whatsappConversation.findUnique({
        where: { id: conversationId },
        include: { lead: true, provider: { include: { organization: { select: { id: true, tipo: true } } } } },
      }).catch(() => null);
      if (conv?.lead?.status === "BLOCKED" || conv?.lead?.status === "CLOSED") {
        console.log(`[FollowUpWorker] Lead ${conv.lead.status} — cancelando follow-up ${followUpId} para conv ${conversationId}`);
        await prisma.conversationFollowUp.update({
          where: { id: followUpId },
          data: { status: "OPT_OUT" },
        }).catch(() => {});
        return;
      }
      if (conv?.etapa === "PERDIDO" || conv?.etapa === "PEDIDO_CONFIRMADO") {
        console.log(`[FollowUpWorker] Conv etapa=${conv.etapa} — skip follow-up ${followUpId}`);
        await prisma.conversationFollowUp.update({ where: { id: followUpId }, data: { status: "DONE" } }).catch(() => {});
        return;
      }

      const orgTipo = conv?.provider?.organization?.tipo ?? "VENDAS";
      const msgs = orgTipo === "PROSPECCAO"
        ? buildProspeccaoFollowupMessage(step, leadName)
        : buildFollowupMessage(step, leadName);
      if (!msgs.length) return;

      const token = accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN ?? undefined;
      for (let i = 0; i < msgs.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 800));
        await sendWhatsAppMessage(phoneNumberId, phoneNumber, msgs[i], token);
        await prisma.whatsappMessage.create({
          data: { content: msgs[i], type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
        });
      }

      // Funil Nexo: follow-up conta como novo toque → 2º/3º Contato
      if (orgTipo === "PROSPECCAO" && conv?.lead && conv.provider?.organization?.id) {
        await moverLeadPorTipo(
          conv.lead.id,
          conv.provider.organization.id,
          step === 1 ? "CONTATO_2" : "CONTATO_3",
          `Follow-up ${step} enviado`,
        );
      }

      if (step >= 4) {
        await prisma.conversationFollowUp.update({ where: { id: followUpId }, data: { status: "DONE", step: 5 } });
        console.log(`[FollowUpWorker] Conv ${conversationId} — todos os follow-ups concluídos`);
      } else {
        const nextStep = step + 1;
        const now = new Date();
        const nextInterval = STEP_INTERVALS_MS[nextStep];
        const nextSendAt = new Date(fu.aiMessageAt.getTime() + nextInterval);

        await prisma.conversationFollowUp.update({ where: { id: followUpId }, data: { step: nextStep, nextSendAt } });

        // Agenda o próximo step
        const queue = getQueue();
        if (queue) {
          const delay = Math.max(0, nextSendAt.getTime() - now.getTime());
          const jobId = `fu_${conversationId}_step${nextStep}`;
          await queue.add(
            "send-followup",
            { followUpId, conversationId, step: nextStep, phoneNumber, phoneNumberId, leadName, accessToken },
            { delay, jobId, deduplication: { id: jobId } },
          );
        }
      }
    },
    {
      connection: conn,
      concurrency: 5,
    },
  );

  worker.on("completed", (job: Job<FollowUpJobData>) => {
    console.log(`[FollowUpWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job: Job<FollowUpJobData> | undefined, err: Error) => {
    console.error(`[FollowUpWorker] Job ${job?.id ?? "unknown"} failed:`, err.message);
  });

  worker.on("error", (err: Error) => {
    console.error("[FollowUpWorker] Worker error:", err.message);
  });

  workerStarted = true;
  console.log("[FollowUpWorker] Worker iniciado e aguardando jobs");
}
