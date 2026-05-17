import { prisma } from "@/lib/prisma/client";
import type { CompiledPrompt } from "./prompt-compiler";
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

  // Use compiled prompt from decision if available, otherwise use empty fallback
  const compiled: CompiledPrompt = decision.compiledPrompt ?? {
    systemPrompt: "",
    layers: { persona: "", estrategia: "", restricoes: "", objecoes: "", catalogo: "", historico: "" },
  };

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

  // Parse JSON response before sending (CORREÇÃO 1)
  let messagesToSend: string[];
  try {
    const stripped = rawResponse.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(stripped) as { mensagens?: unknown };
    messagesToSend = Array.isArray(parsed.mensagens)
      ? (parsed.mensagens as unknown[]).map((m) => String(m).trim()).filter(Boolean)
      : [rawResponse];
  } catch {
    // Try extracting embedded JSON
    const jsonMatch = rawResponse.match(/\{[\s\S]*"mensagens"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { mensagens?: unknown };
        messagesToSend = Array.isArray(parsed.mensagens)
          ? (parsed.mensagens as unknown[]).map((m) => String(m).trim()).filter(Boolean)
          : [rawResponse];
      } catch {
        messagesToSend = [rawResponse];
      }
    } else {
      messagesToSend = [rawResponse];
    }
  }

  // Typing indicator — fires before sending the actual response
  if (ctx.incomingMessageId) {
    await sendWhatsAppTyping(ctx.phoneNumberId, ctx.incomingMessageId, ctx.phoneNumber, ctx.accessToken).catch(() => {});
    const firstMsg = messagesToSend[0] ?? rawResponse;
    const delayMs = Math.min(Math.max(firstMsg.length * 32, 1500), 6000);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  // Send messages
  for (let i = 0; i < messagesToSend.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000));
    await sendWhatsAppMessage(ctx.phoneNumberId, ctx.phoneNumber, messagesToSend[i], ctx.accessToken);
  }

  // Persist AI messages
  for (const msg of messagesToSend) {
    await prisma.whatsappMessage.create({
      data: {
        content: msg,
        type: "TEXT",
        role: "ASSISTANT",
        sentAt: new Date(),
        status: "SENT",
        conversationId: ctx.conversationId,
      },
    });
  }

  // Update conversation timestamp
  await prisma.whatsappConversation.update({
    where: { id: ctx.conversationId },
    data: { lastMessageAt: new Date() },
  }).catch(() => {});

  console.log(`[Responder] Sent ${messagesToSend.length} msg(s) to conv ${ctx.conversationId}`);
  return { sent: true, message: messagesToSend[messagesToSend.length - 1] ?? rawResponse };
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
