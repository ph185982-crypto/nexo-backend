import { Queue, Worker, Job, QueueEvents } from "bullmq";
import { getRedisClient } from "./redis-client";
import { prisma } from "@/lib/prisma/client";
import { compilePrompt } from "@/lib/ai/prompt-compiler";
import { callLLM } from "@/lib/ai/llm-client";
import { sendWhatsAppMessage, sendWhatsAppTyping } from "@/lib/whatsapp/send";

// ─── Job Types ────────────────────────────────────────────────────────────────

export interface FollowUpJobData {
  conversationId: string;
  step: number;
  totalSteps: number;
  phoneNumber: string;
  phoneNumberId: string;
  accessToken?: string;
  leadName?: string | null;
}

// ─── Queue singleton ──────────────────────────────────────────────────────────

const QUEUE_NAME = "followup";
let _queue: Queue<FollowUpJobData> | null = null;

export function getFollowUpQueue(): Queue<FollowUpJobData> {
  if (!_queue) {
    _queue = new Queue<FollowUpJobData>(QUEUE_NAME, {
      connection: getRedisClient(),
      defaultJobOptions: {
        removeOnComplete: 100, // keep last 100 completed jobs for debugging
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
      },
    });
  }
  return _queue;
}

// ─── Schedule a follow-up ──────────────────────────────────────────────────────

/**
 * Enqueues a follow-up job with the given delay.
 * Returns the BullMQ job ID so it can be cancelled later.
 */
export async function scheduleFollowUp(
  data: FollowUpJobData,
  delayMs: number,
): Promise<string> {
  const queue = getFollowUpQueue();
  // Job ID = conversationId + step — ensures only ONE job per step per conversation
  const jobId = `followup:${data.conversationId}:step${data.step}`;
  await queue.add("send-followup", data, { jobId, delay: delayMs });
  console.log(`[FollowUpQueue] Scheduled step=${data.step} for conv ${data.conversationId} in ${Math.round(delayMs / 60_000)}min`);
  return jobId;
}

// ─── Cancel all pending follow-ups for a conversation ───────────────────────────
// Regra de Ouro: qualquer mensagem do lead cancela TODOS os follow-ups pendentes.

export async function cancelFollowUpsForConversation(conversationId: string): Promise<number> {
  const queue = getFollowUpQueue();
  let cancelled = 0;

  // Get all jobs (waiting + delayed) and remove those matching this conversation
  const [waiting, delayed] = await Promise.all([
    queue.getJobs(["waiting"]),
    queue.getJobs(["delayed"]),
  ]);

  const toCancel = [...waiting, ...delayed].filter(
    (job) => job.data.conversationId === conversationId,
  );

  await Promise.all(
    toCancel.map(async (job) => {
      await job.remove();
      cancelled++;
    }),
  );

  // Also mark DB record as DONE
  await prisma.conversationFollowUp.updateMany({
    where: { conversationId, status: "ACTIVE" },
    data: { status: "DONE" },
  }).catch(() => {});

  if (cancelled > 0) {
    console.log(`[FollowUpQueue] Cancelled ${cancelled} follow-up job(s) for conv ${conversationId}`);
  }
  return cancelled;
}

// ─── Follow-up message generator using PromptCompiler ────────────────────────

async function generateFollowUpMessage(job: Job<FollowUpJobData>): Promise<string> {
  const { conversationId, step, totalSteps, leadName } = job.data;

  // Load conversation messages
  const messages = await prisma.whatsappMessage.findMany({
    where: { conversationId },
    orderBy: { sentAt: "asc" },
    take: 20,
    select: { role: true, content: true },
  });
  const history = messages.map((m) => ({ role: m.role, content: m.content }));

  // Load agent config for provider/model
  const agentConfig = await prisma.agentConfig.findFirst({
    include: { personalityProfile: true },
  });

  // Use PromptCompiler to get the full system prompt (layers 1–3)
  const compiled = await compilePrompt(conversationId, history, { action: "FOLLOW_UP" });

  const stepFraction = totalSteps <= 1 ? 1 : step / totalSteps;
  const stepTone =
    step === 1 ? "toque leve, sem pressão — pergunta se ficou alguma dúvida"
    : stepFraction < 0.5 ? "mencione um benefício novo ou aborde a objeção que ficou"
    : stepFraction < 0.85 ? "crie urgência leve (estoque, outros interessados)"
    : "encerre com porta aberta, agradeça o interesse sem pressão";

  const systemPrompt = `${compiled.systemPrompt}

ATENÇÃO — Você está em modo FOLLOW-UP (etapa ${step}/${totalSteps}).
Escreva UMA mensagem curta de recuperação de venda (máximo 2 frases), estilo WhatsApp informal.
Tom: ${stepTone}
${leadName ? `Nome do cliente: ${leadName}` : ""}
Responda APENAS a mensagem, sem explicações.`;

  const historyText = history
    .slice(-6)
    .map((m) => `${m.role === "USER" ? "Cliente" : "IA"}: ${m.content}`)
    .join("\n");

  const agent = await prisma.agent.findFirst({
    where: { config: { conversations: { some: { id: conversationId } } } },
  }).catch(() => null);

  const response = await callLLM(
    systemPrompt,
    [],
    `Histórico:\n${historyText}\n\nEscreva a mensagem de follow-up:`,
    agent?.aiProvider,
    agent?.aiModel,
    { maxTokens: 120, temperature: 0.9 },
  );

  if (response) return response;

  // Hard fallback — static messages if LLM unavailable
  const fallbacks: Record<number, string> = {
    1: "conseguiu ver aí? 🙂",
    2: "ainda tenho disponível pra você",
    3: "últimas unidades 👀",
  };
  return fallbacks[step] ?? (leadName ? `${leadName}, qualquer coisa pode me chamar 👊` : "qualquer coisa pode me chamar 👊");
}

// ─── Worker processor ─────────────────────────────────────────────────────────

async function processFollowUpJob(job: Job<FollowUpJobData>): Promise<void> {
  const { conversationId, step, totalSteps, phoneNumber, phoneNumberId, accessToken } = job.data;
  console.log(`[FollowUpWorker] Processing step=${step} for conv ${conversationId}`);

  // Guard: if lead already replied after this job was scheduled, skip
  const fu = await prisma.conversationFollowUp.findUnique({ where: { conversationId } });
  if (!fu || fu.status !== "ACTIVE") {
    console.log(`[FollowUpWorker] Skipped — follow-up no longer active for conv ${conversationId}`);
    return;
  }

  // Guard: skip if lead escalated or closed
  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    include: { lead: true },
  });
  if (!conversation || conversation.lead?.status === "ESCALATED" || conversation.lead?.status === "CLOSED") {
    await prisma.conversationFollowUp.updateMany({ where: { conversationId }, data: { status: "DONE" } });
    return;
  }

  const message = await generateFollowUpMessage(job);

  // Simulate typing indicator (mark read + typing)
  const lastUserMsg = await prisma.whatsappMessage.findFirst({
    where: { conversationId, role: "USER" },
    orderBy: { sentAt: "desc" },
  });
  if (lastUserMsg) {
    await sendWhatsAppTyping(phoneNumberId, lastUserMsg.id, phoneNumber, accessToken).catch(() => {});
    // Natural delay proportional to message length
    const delayMs = Math.min(Math.max(message.length * 35, 1500), 5000);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  // Send the message
  await sendWhatsAppMessage(phoneNumberId, phoneNumber, message, accessToken);

  // Save to DB
  const now = new Date();
  await prisma.whatsappMessage.create({
    data: { content: message, type: "TEXT", role: "ASSISTANT", sentAt: now, status: "SENT", conversationId },
  });

  // Schedule next step or close
  const agentConfig = await prisma.agentConfig.findFirst();
  const maxSteps = agentConfig?.maxFollowUps ?? 4;

  if (step >= maxSteps) {
    await prisma.conversationFollowUp.update({ where: { conversationId }, data: { status: "DONE" } });
    console.log(`[FollowUpWorker] All ${maxSteps} steps completed for conv ${conversationId}`);
  } else {
    const hours = (agentConfig?.followUpHours ?? "4,24,48,72").split(",").map(Number).filter(Boolean);
    const nextDelayMs = (hours[step] ?? hours[hours.length - 1] ?? 24) * 3_600_000;
    const nextStep = step + 1;

    await scheduleFollowUp({ ...job.data, step: nextStep }, nextDelayMs);
    await prisma.conversationFollowUp.update({
      where: { conversationId },
      data: { step: nextStep, nextSendAt: new Date(Date.now() + nextDelayMs) },
    });
  }
}

// ─── Worker factory — called once from instrumentation.ts ─────────────────────

let _worker: Worker | null = null;

export function startFollowUpWorker(): Worker {
  if (_worker) return _worker;

  _worker = new Worker<FollowUpJobData>(QUEUE_NAME, processFollowUpJob, {
    connection: getRedisClient(),
    concurrency: 5,
  });

  _worker.on("completed", (job) =>
    console.log(`[FollowUpWorker] Job ${job.id} completed`),
  );
  _worker.on("failed", (job, err) =>
    console.error(`[FollowUpWorker] Job ${job?.id} failed:`, err.message),
  );

  console.log("[FollowUpWorker] Started — listening for follow-up jobs");
  return _worker;
}
