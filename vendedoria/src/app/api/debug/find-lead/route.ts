/**
 * GET /api/debug/find-lead?name=<busca>&secret=<CRON_SECRET>
 * Busca leads por nome (contains, case-insensitive) para investigação manual.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const name = searchParams.get("name") ?? "";
  const phone = searchParams.get("phone") ?? "";
  if (!name && !phone) return NextResponse.json({ error: "name ou phone obrigatório" }, { status: 400 });

  const leads = await prisma.lead.findMany({
    where: phone
      ? { phoneNumber: { contains: phone.replace(/\D/g, "").slice(-8) } }
      : { profileName: { contains: name, mode: "insensitive" } },
    select: {
      id: true, profileName: true, phoneNumber: true, status: true,
      organizationId: true, createdAt: true, lastActivityAt: true,
      organization: { select: { name: true, tipo: true } },
      kanbanColumn: { select: { name: true, type: true } },
      conversations: {
        select: {
          id: true, isActive: true, humanTakeover: true, lastMessageAt: true,
          etapa: true,
          provider: { select: { businessPhoneNumberId: true, accessToken: true, agent: { select: { systemPrompt: true, kind: true, status: true, sandboxMode: true } } } },
        },
      },
    },
  });

  const withExtras = await Promise.all(
    leads.map(async (l) => ({
      ...l,
      conversations: await Promise.all(
        l.conversations.map(async (c) => {
          const [conv, messages, ownerNotifs] = await Promise.all([
            prisma.whatsappConversation.findUnique({
              where: { id: c.id },
              select: { sessaoProspeccao: true },
            }),
            prisma.whatsappMessage.findMany({
              where: { conversationId: c.id },
              orderBy: { sentAt: "asc" },
              select: { role: true, content: true, sentAt: true, status: true, wamid: true, aiProcessedAt: true },
            }),
            prisma.ownerNotification.findMany({
              where: { conversationId: c.id },
              select: { type: true, title: true, body: true, createdAt: true },
            }),
          ]);
          return {
            ...c,
            provider: {
              businessPhoneNumberId: c.provider?.businessPhoneNumberId,
              hasAccessToken: !!c.provider?.accessToken,
              agent: c.provider?.agent
                ? { ...c.provider.agent, isSdr: c.provider.agent.systemPrompt?.trimStart().startsWith("[SDR]") ?? false, systemPrompt: undefined }
                : null,
            },
            sdrSession: (conv?.sessaoProspeccao as Record<string, unknown>)?.sdr ?? null,
            ownerNotifications: ownerNotifs,
            messages,
          };
        }),
      ),
    })),
  );

  // Quando busca por telefone, também procura direto em WhatsappConversation —
  // o dono/especialista não é necessariamente um Lead, mas se ele já mandou
  // mensagem pro número do bot alguma vez, existe uma conversa com o histórico
  // que diz se a janela de 24h da Meta está aberta.
  let ownerConversation = null;
  if (phone) {
    const digits = phone.replace(/\D/g, "").slice(-8);
    const conv = await prisma.whatsappConversation.findFirst({
      where: { customerWhatsappBusinessId: { contains: digits } },
      select: { id: true, customerWhatsappBusinessId: true, lastMessageAt: true },
    });
    if (conv) {
      const lastInbound = await prisma.whatsappMessage.findFirst({
        where: { conversationId: conv.id, role: "USER" },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true, content: true },
      });
      ownerConversation = {
        ...conv,
        lastInboundFromOwner: lastInbound,
        horasDesdeUltimaMensagemDono: lastInbound
          ? (Date.now() - new Date(lastInbound.sentAt).getTime()) / 3_600_000
          : null,
      };
    } else {
      ownerConversation = { error: `Nenhuma WhatsappConversation encontrada terminando em ${digits}` };
    }
  }

  const pushSubscriptionsCount = await prisma.pushSubscription.count();

  return NextResponse.json({ count: leads.length, leads: withExtras, ownerConversation, pushSubscriptionsCount });
}
