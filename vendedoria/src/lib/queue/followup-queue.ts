// Follow-up Queue — BullMQ + Redis
// Agenda follow-ups com delay preciso. Complementa o cron de polling.
// Se REDIS_URL não estiver disponível, cai silenciosamente para o modo cron.

import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

const QUEUE_NAME = "followup";

// ── Intervalos por step ────────────────────────────────────────────────────────
const STEP_INTERVALS_MS: Record<number, number> = {
  1: 4  * 60 * 60 * 1000,   // step 1 — 4h
  2: 24 * 60 * 60 * 1000,   // step 2 — 24h
  3: 48 * 60 * 60 * 1000,   // step 3 — 48h
  4: 72 * 60 * 60 * 1000,   // step 4 — 72h
};

// ── Mensagem por step ─────────────────────────────────────────────────────────
function buildFollowupMessage(step: number, name: string | null): string {
  switch (step) {
    case 1: return "conseguiu ver aí? 🙂";
    case 2: return "ainda tenho disponível...";
    case 3: return "últimas unidades viu...";
    case 4: return name ? `${name}, qualquer coisa pode me chamar 👊` : "qualquer coisa pode me chamar 👊";
    default: return "";
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

      const msg = buildFollowupMessage(step, leadName);
      if (!msg) return;

      const token = accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN ?? undefined;
      await sendWhatsAppMessage(phoneNumberId, phoneNumber, msg, token);

      await prisma.whatsappMessage.create({
        data: { content: msg, type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
      });

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

  workerStarted = true;
  console.log("[FollowUpWorker] Worker iniciado e aguardando jobs");
}
