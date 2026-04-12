import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { createHmac } from "crypto";

const INTERVALS_MS = [
  4  * 60 * 60 * 1000,  // step 1 — 4h
  24 * 60 * 60 * 1000,  // step 2 — 24h
  48 * 60 * 60 * 1000,  // step 3 — 48h
  72 * 60 * 60 * 1000,  // step 4 — 72h
];

const FOLLOWUP_SYSTEM_PROMPT = `Você é Léo, vendedor da Nexo Brasil. Você está fazendo um follow-up com um cliente que parou de responder.

Escreva UMA mensagem curta (máximo 2 frases), no estilo WhatsApp — informal, sem formalidade, sem "certamente", sem "prezado".
A mensagem deve ser única, personalizada para esse cliente específico, baseada no histórico da conversa.

Cada etapa tem um tom diferente:
- Etapa 1 (4h): toca leve, pergunta se ficou alguma dúvida, sem pressão
- Etapa 2 (24h): traz um benefício específico que ainda não foi mencionado ou que resolveria a objeção do cliente
- Etapa 3 (48h): usa prova social ou urgência (estoque, clientes que compraram), ainda sem desespero
- Etapa 4 (72h): encerra com porta aberta, sem pressão — agradece o interesse

Regras:
- Mensagem curta, máximo 2 frases
- Use o nome do cliente se souber
- Baseie-se no que o cliente disse antes (objeção, interesse, produto, etc.)
- Não repita o mesmo argumento que já não funcionou
- Tom humano, natural, como um vendedor real escreveria
- Responda APENAS a mensagem de follow-up, sem explicação ou metadados`;

async function generateFollowupMessage(
  step: number,
  leadName: string | null,
  conversationHistory: Array<{ role: string; content: string }>,
): Promise<string | null> {
  const stepDesc = [
    "Etapa 1 (4h depois) — toque leve, pergunta se ficou dúvida",
    "Etapa 2 (24h depois) — benefício novo ou argumento para a objeção",
    "Etapa 3 (48h depois) — prova social ou urgência leve",
    "Etapa 4 (72h depois) — encerramento com porta aberta, sem pressão",
  ][step - 1] ?? "Follow-up";

  const historyText = conversationHistory
    .slice(-10)
    .map((m) => `${m.role === "USER" ? "Cliente" : "Léo"}: ${m.content}`)
    .join("\n");

  const userPrompt =
    `${stepDesc}\n` +
    (leadName ? `Nome do cliente: ${leadName}\n` : "") +
    `\nHistórico recente:\n${historyText}\n\nEscreva a mensagem de follow-up:`;

  // Try LLM providers in order of availability
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          system: FOLLOWUP_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
          max_tokens: 120,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { content?: Array<{ text?: string }> };
        const text = data.content?.[0]?.text?.trim();
        if (text) return text;
      }
    } catch (e) {
      console.error("[FollowUp] Anthropic LLM error:", e);
    }
  }

  if (process.env.GOOGLE_AI_API_KEY) {
    try {
      const model = "gemini-2.0-flash-lite";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: FOLLOWUP_SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { maxOutputTokens: 120, temperature: 0.9 },
        }),
      });
      if (res.ok) {
        const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      }
    } catch (e) {
      console.error("[FollowUp] Gemini LLM error:", e);
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: FOLLOWUP_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 120,
          temperature: 0.9,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      }
    } catch (e) {
      console.error("[FollowUp] OpenAI LLM error:", e);
    }
  }

  return null;
}

// Fallback fixed messages if LLM is unavailable
function fallbackFollowupMessage(step: number, name: string | null): string {
  switch (step) {
    case 1: return "conseguiu ver aí? 🙂";
    case 2: return "ainda tenho disponível...";
    case 3: return "últimas unidades viu...";
    case 4: return name ? `${name}, qualquer coisa pode me chamar 👊` : "qualquer coisa pode me chamar 👊";
    default: return "";
  }
}

export async function GET() {
  const now = new Date();
  const results = { checked: 0, sent: 0, closed: 0, errors: 0 };

  const due = await prisma.conversationFollowUp.findMany({
    where: { status: "ACTIVE", nextSendAt: { lte: now } },
    take: 50,
  });

  results.checked = due.length;

  for (const fu of due) {
    try {
      // Fetch conversation history for personalized message generation
      const messages = await prisma.whatsappMessage.findMany({
        where: { conversationId: fu.conversationId },
        orderBy: { sentAt: "desc" },
        take: 15,
        select: { role: true, content: true },
      });
      const history = messages.reverse().map((m) => ({ role: m.role, content: m.content }));

      // Try LLM-generated personalized message, fall back to fixed strings
      const msg =
        (await generateFollowupMessage(fu.step, fu.leadName, history)) ??
        fallbackFollowupMessage(fu.step, fu.leadName);

      if (!msg) continue;

      const token = fu.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN ?? undefined;
      await sendWhatsAppMessage(fu.phoneNumberId, fu.phoneNumber, msg, token);

      // Save follow-up message to conversation
      await prisma.whatsappMessage.create({
        data: {
          content: msg,
          type: "TEXT",
          role: "ASSISTANT",
          sentAt: now,
          status: "SENT",
          conversationId: fu.conversationId,
        },
      });

      if (fu.step >= 4) {
        // All follow-ups exhausted — mark as done
        await prisma.conversationFollowUp.update({
          where: { id: fu.id },
          data: { status: "DONE", step: 5 },
        });
        results.closed++;
      } else {
        // Advance to next step
        const nextStep = fu.step + 1;
        const nextSendAt = new Date(fu.aiMessageAt.getTime() + INTERVALS_MS[nextStep - 1]);
        await prisma.conversationFollowUp.update({
          where: { id: fu.id },
          data: { step: nextStep, nextSendAt },
        });
      }

      results.sent++;
    } catch (err) {
      console.error("[FollowUp] Error sending to", fu.phoneNumber, err);
      results.errors++;
    }
  }

  // ── Process retry queue ───────────────────────────────────────────────────
  const queueResults = { retried: 0, requeued: 0, dropped: 0 };
  const pending = await prisma.webhookQueue.findMany({
    where: { status: "PENDING", retryAfter: { lte: now } },
    take: 20,
    orderBy: { createdAt: "asc" },
  });

  for (const item of pending) {
    if (item.attempts >= 5) {
      await prisma.webhookQueue.update({ where: { id: item.id }, data: { status: "FAILED" } });
      queueResults.dropped++;
      continue;
    }

    try {
      const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:10000";
      const secret = process.env.META_WHATSAPP_APP_SECRET ?? "";
      const sig = "sha256=" + createHmac("sha256", secret).update(item.payload).digest("hex");

      const res = await fetch(`${baseUrl}/api/webhooks/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-hub-signature-256": sig },
        body: item.payload,
      });

      if (res.ok) {
        const json = await res.json() as { queued?: boolean };
        if (!json.queued) {
          await prisma.webhookQueue.update({ where: { id: item.id }, data: { status: "PROCESSED" } });
          queueResults.retried++;
        } else {
          const backoff = Math.min(300_000, 30_000 * (item.attempts + 1));
          await prisma.webhookQueue.update({
            where: { id: item.id },
            data: { attempts: item.attempts + 1, retryAfter: new Date(Date.now() + backoff) },
          });
          queueResults.requeued++;
        }
      }
    } catch (err) {
      await prisma.webhookQueue.update({
        where: { id: item.id },
        data: { attempts: item.attempts + 1, error: String(err), retryAfter: new Date(Date.now() + 60_000) },
      });
      queueResults.requeued++;
    }
  }

  return NextResponse.json({ ok: true, followups: results, queue: queueResults });
}
