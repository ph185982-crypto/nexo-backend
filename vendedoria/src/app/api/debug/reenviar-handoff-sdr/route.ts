/**
 * GET /api/debug/reenviar-handoff-sdr?conversationId=xxx&secret=<CRON_SECRET>
 * Reenvia manualmente a notificação de passagem de bastão do SDR pra um lead
 * já escalado — usa a sessão SDR já salva na conversa. Útil quando o envio
 * original falhou (ex.: janela de 24h da Meta fechada) e o lead já mudou de
 * status, então o fluxo normal não dispararia de novo.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { loadSdrSession } from "@/lib/ai/sdr/session";
import { formatHandoffMessage, notificarHandoff } from "@/lib/ai/sdr/agent";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const conversationId = searchParams.get("conversationId") ?? "";
  if (!conversationId) return NextResponse.json({ error: "conversationId obrigatório" }, { status: 400 });

  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    include: {
      lead: { select: { id: true, phoneNumber: true } },
      provider: { select: { businessPhoneNumberId: true, accessToken: true, organizationId: true } },
    },
  });
  if (!conversation?.lead || !conversation.provider) {
    return NextResponse.json({ error: "Conversa ou lead não encontrado" }, { status: 404 });
  }

  const session = await loadSdrSession(conversationId);
  const bastao = formatHandoffMessage(conversation.lead.phoneNumber, session);

  const resultado = await notificarHandoff(
    bastao,
    conversation.provider.businessPhoneNumberId,
    conversation.provider.accessToken ?? undefined,
    conversation.provider.organizationId,
    conversation.lead.id,
    conversationId,
  );

  return NextResponse.json({ ok: true, ...resultado, bastao, session });
}
