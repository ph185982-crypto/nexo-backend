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

function buildFollowupMessage(step: number, name: string | null): string {
  const nome = name ?? "você";
  switch (step) {
    case 1:
      return "Oi! Só passando pra ver se ficou alguma dúvida sobre a chave que te mostrei 😊 Pode perguntar à vontade!";
    case 2:
      return `Oi ${nome}! Lembrei de te contar uma coisa que esqueci: a Bomvink já vem com 46 peças de soquetes e acessórios dentro da maleta — você não precisa comprar mais nada separado. E pagamento só na entrega, sem risco. Ainda tem interesse?`;
    case 3:
      return "Oi! Hoje cedo um cliente aqui do Setor Bueno retirou a última unidade que tinha reservada. Ainda tenho uma disponível pra região. Se quiser garantir a sua, é só falar — você paga só quando receber. 🔧";
    case 4:
      return `Oi ${nome}, última vez que passo aqui pra não te incomodar 😄 Se um dia precisar de ferramentas profissionais em Goiânia, pode me chamar. Abraço e sucesso no trabalho! 👊`;
    default:
      return "";
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
      const msg = buildFollowupMessage(fu.step, fu.leadName);
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
        // All follow-ups exhausted — mark as lost
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

  // ── CORREÇÃO 3: Process retry queue ───────────────────────────────────────
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
      // Re-deliver the queued webhook payload to the webhook handler
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
          // Processed successfully
          await prisma.webhookQueue.update({ where: { id: item.id }, data: { status: "PROCESSED" } });
          queueResults.retried++;
        } else {
          // Still failed — reschedule with backoff
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
