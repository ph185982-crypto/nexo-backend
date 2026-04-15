/**
 * POST /api/debug/reenviar-passagem
 * Forces resend of the handoff notification regardless of resumoEnviado flag.
 * body: { conversationId: string }
 *
 * GET /api/debug/reenviar-passagem?conversationId=xxx&secret=<CRON_SECRET>
 * Same, via URL (for quick manual trigger from browser).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

async function handler(conversationId: string): Promise<{ ok: boolean; msg?: string; error?: string }> {
  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    include: { provider: true, lead: true, messages: { orderBy: { sentAt: "desc" }, take: 50 } },
  });

  if (!conversation) return { ok: false, error: "Conversa não encontrada" };

  const provider = conversation.provider;
  const lead = conversation.lead;

  type MsgList = NonNullable<typeof conversation>["messages"];
  // ── Extract collected data from message history ───────────────────────────
  function extractField(patterns: RegExp[], messages: MsgList, roleFilter?: string): string | undefined {
    for (const msg of messages) {
      if (roleFilter && msg.role !== roleFilter) continue;
      for (const p of patterns) {
        const m = p.exec(msg.content);
        if (m) return m[1] ?? msg.content;
      }
    }
    return undefined;
  }

  const msgs = conversation.messages;
  const allText = msgs.map((m) => m.content).join("\n").toLowerCase();

  const locMsg = msgs.find((m) =>
    /lat:[-\d.]+\s+lng:[-\d.]+/.test(m.content) ||
    /maps\.google\.com/.test(m.content) ||
    /maps\.app\.goo\.gl/.test(m.content) ||
    /\[Localiza[çc][aã]o\s+recebida\]/.test(m.content)
  );
  const endereco = locMsg?.content ??
    msgs.find((m) => m.role === "USER" && /\b(rua|av\.?|setor|quadra|goiania|goiânia)\b/i.test(m.content))?.content ??
    "não informado";

  const horario = msgs.find((m) => m.role === "USER" && /\b(\d{1,2})\s*[h:]\s*(\d{0,2})|(até|ate)\s+\d/.test(m.content))?.content ?? "não informado";

  const pagamento = /\bdinheiro\b/.test(allText) ? "dinheiro"
    : /\bpix\b/.test(allText) ? "pix"
    : /\bcart[aã]o\b/.test(allText) ? "cartão"
    : "não informado";

  const nomeMsg = msgs.find((m) => m.role === "USER" && /(?:meu\s+nome\s+[eé]|me\s+chamo|chamo[-\s]+me)\s+([A-Za-záéíóú]{2,})/i.test(m.content));
  const nome = nomeMsg
    ? (/(?:meu\s+nome\s+[eé]|me\s+chamo|chamo[-\s]+me)\s+([A-Za-záéíóú][A-Za-záéíóú\s]{1,})/i.exec(nomeMsg.content)?.[1] ?? lead?.profileName)
    : lead?.profileName ?? "não informado";

  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER ??
    (await prisma.agentConfig.findFirst().then((c) => c?.bastaoNumber)) ??
    "5562984465388";

  const to = conversation.customerWhatsappBusinessId;
  const token = provider.accessToken ?? undefined;

  const handoffMsg =
    `*🔔 PEDIDO NOVO (REENVIO) — NEXO BRASIL*\n\n` +
    `👤 *Cliente:* ${lead?.profileName ?? to}\n` +
    `📱 *WhatsApp:* ${to}\n` +
    `🏠 *Endereço/Localização:* ${endereco}\n` +
    `⏰ *Receber até:* ${horario}\n` +
    `💳 *Pagamento:* ${pagamento}\n` +
    `🙍 *Nome recebedor:* ${nome}\n\n` +
    `_Reenvio manual via CRM — organize a entrega._`;

  // ── Send with retry ───────────────────────────────────────────────────────
  let sucesso = false;
  for (let t = 1; t <= 3; t++) {
    try {
      await sendWhatsAppMessage(provider.businessPhoneNumberId, ownerNumber, handoffMsg, token);
      sucesso = true;
      console.log(`[reenviar-passagem] ✅ Enviado para ${ownerNumber} na tentativa ${t}`);
      break;
    } catch (err) {
      console.error(`[reenviar-passagem] ❌ Tentativa ${t}:`, err);
      if (t < 3) await new Promise((r) => setTimeout(r, 5000));
    }
  }

  if (!sucesso) return { ok: false, error: "Falha ao enviar pelo WhatsApp após 3 tentativas" };

  // ── Mark as sent ──────────────────────────────────────────────────────────
  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { resumoEnviado: true, etapa: "PEDIDO_CONFIRMADO" },
  });

  await prisma.conversationFollowUp.updateMany({
    where: { conversationId, status: { not: "DONE" } },
    data: { status: "DONE" },
  }).catch(() => {});

  return { ok: true, msg: `Passagem reenviada para ${ownerNumber}` };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { conversationId?: string };
    const { conversationId } = body;
    if (!conversationId) return NextResponse.json({ error: "conversationId obrigatório" }, { status: 400 });
    const result = await handler(conversationId);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get("conversationId");
  const secret = searchParams.get("secret");

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && secret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!conversationId) return NextResponse.json({ error: "conversationId obrigatório" }, { status: 400 });

  try {
    const result = await handler(conversationId);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
