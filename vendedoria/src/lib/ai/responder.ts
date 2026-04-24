import { prisma } from "@/lib/prisma/client";
import { compilePrompt } from "./prompt-compiler";
import { callLLM } from "./llm-client";
import { sendWhatsAppMessage, sendWhatsAppTyping } from "@/lib/whatsapp/send";
import type { AIDecisionResult } from "./orchestrator";

// ─── Responder: takes a decision and sends the final reply ────────────────────

export interface ResponderContext {
  conversationId: string;
  phoneNumber: string;
  phoneNumberId: string;
  incomingMessageId?: string;
  accessToken?: string;
  aiProvider?: string | null;
  aiModel?: string | null;
}

export interface ResponderResult {
  sent: boolean;
  message?: string;
  skipped?: string; // reason if not sent
}

/**
 * Given a RESPOND decision with a compiled prompt, generates the final AI
 * message, shows "digitando...", and delivers it via WhatsApp.
 */
export async function sendAIResponse(
  ctx: ResponderContext,
  decision: AIDecisionResult,
  userMessage: string,
): Promise<ResponderResult> {
  if (decision.action !== "RESPOND") {
    return { sent: false, skipped: `action=${decision.action} — not RESPOND` };
  }

  // Load recent history for context
  const recentMessages = await prisma.whatsappMessage.findMany({
    where: { conversationId: ctx.conversationId },
    orderBy: { sentAt: "desc" },
    take: 20,
    select: { role: true, content: true },
  });
  const history = recentMessages
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Use compiled prompt from decision if available, otherwise compile now
  const compiled =
    decision.compiledPrompt ??
    (await compilePrompt(ctx.conversationId, history, { action: "RESPOND" }));

  // Call LLM with the compiled system prompt
  const rawResponse = await callLLM(
    compiled.systemPrompt,
    history.map((m) => ({ role: m.role, content: m.content })),
    userMessage,
    ctx.aiProvider,
    ctx.aiModel,
    { maxTokens: 450, temperature: 0.85 },
  );

  if (!rawResponse) {
    console.error(`[Responder] LLM returned null for conv ${ctx.conversationId}`);
    return { sent: false, skipped: "LLM returned null" };
  }

  // Typing indicator — fires before sending the actual response
  if (ctx.incomingMessageId) {
    await sendWhatsAppTyping(ctx.phoneNumberId, ctx.incomingMessageId, ctx.phoneNumber, ctx.accessToken).catch(() => {});
    // Proportional delay: min 1.5s, max 6s
    const delayMs = Math.min(Math.max(rawResponse.length * 32, 1500), 6000);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  // Send message
  await sendWhatsAppMessage(ctx.phoneNumberId, ctx.phoneNumber, rawResponse, ctx.accessToken);

  // Persist AI message
  await prisma.whatsappMessage.create({
    data: {
      content: rawResponse,
      type: "TEXT",
      role: "ASSISTANT",
      sentAt: new Date(),
      status: "SENT",
      conversationId: ctx.conversationId,
    },
  });

  // Update conversation timestamp
  await prisma.whatsappConversation.update({
    where: { id: ctx.conversationId },
    data: { lastMessageAt: new Date() },
  }).catch(() => {});

  console.log(`[Responder] Sent ${rawResponse.length}ch to conv ${ctx.conversationId}`);
  return { sent: true, message: rawResponse };
}

/**
 * Sends multiple messages (array of strings) with natural pauses between them.
 * Used when the AI naturally produces a list of short messages.
 */
export async function sendMultiPartResponse(
  ctx: ResponderContext,
  messages: string[],
): Promise<ResponderResult> {
  let lastSent = "";
  for (const msg of messages) {
    if (!msg.trim()) continue;
    if (ctx.incomingMessageId) {
      await sendWhatsAppTyping(ctx.phoneNumberId, ctx.incomingMessageId, ctx.phoneNumber, ctx.accessToken).catch(() => {});
      const delay = Math.min(Math.max(msg.length * 32, 800), 4000);
      await new Promise((r) => setTimeout(r, delay));
    }
    await sendWhatsAppMessage(ctx.phoneNumberId, ctx.phoneNumber, msg, ctx.accessToken);
    await prisma.whatsappMessage.create({
      data: { content: msg, type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId: ctx.conversationId },
    });
    lastSent = msg;
  }
  await prisma.whatsappConversation.update({ where: { id: ctx.conversationId }, data: { lastMessageAt: new Date() } }).catch(() => {});
  return { sent: true, message: lastSent };
}
