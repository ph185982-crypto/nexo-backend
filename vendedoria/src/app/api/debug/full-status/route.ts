/**
 * GET /api/debug/full-status
 * Diagnóstico completo do fluxo de atendimento — autenticado por sessão (admin).
 * Detecta: providers duplicados no mesmo número, organizações, passagens/escalações reais.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [providers, orgs, kanbanColumns, totalLeads, totalConversations, totalMessages, escalatedLeads, closedLeads, ownerNotifs, recentMsgs] =
    await Promise.all([
      prisma.whatsappProviderConfig.findMany({
        select: {
          id: true, accountName: true, businessPhoneNumberId: true, status: true,
          organizationId: true,
          agent: { select: { id: true, displayName: true, kind: true, status: true, aiProvider: true, aiModel: true } },
        },
      }),
      prisma.whatsappBusinessOrganization.findMany({
        select: { id: true, name: true, tipo: true, status: true },
      }),
      prisma.kanbanColumn.findMany({
        select: { id: true, name: true, type: true, order: true, organizationId: true, isDefaultEntry: true },
        orderBy: { order: "asc" },
      }),
      prisma.lead.count(),
      prisma.whatsappConversation.count(),
      prisma.whatsappMessage.count(),
      prisma.lead.findMany({
        where: { status: "ESCALATED" },
        select: { id: true, profileName: true, phoneNumber: true, organizationId: true, lastActivityAt: true },
        orderBy: { lastActivityAt: "desc" },
        take: 10,
      }),
      prisma.lead.findMany({
        where: { status: "CLOSED" },
        select: { id: true, profileName: true, phoneNumber: true, organizationId: true },
        take: 10,
      }),
      prisma.ownerNotification.findMany({
        where: { type: { in: ["ORDER", "ESCALATION"] } },
        select: { id: true, type: true, title: true, createdAt: true, organizationId: true },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
      prisma.whatsappMessage.findMany({
        orderBy: { sentAt: "desc" },
        take: 10,
        select: { id: true, role: true, content: true, sentAt: true, conversationId: true, status: true },
      }),
    ]);

  const audioMessages = await prisma.whatsappMessage.findMany({
    where: { type: "AUDIO" },
    orderBy: { sentAt: "desc" },
    take: 15,
    select: { id: true, content: true, mediaUrl: true, sentAt: true, conversationId: true },
  });

  // Detecta duplicidade: mesmo businessPhoneNumberId em mais de um provider
  const byPhone: Record<string, typeof providers> = {};
  for (const p of providers) {
    const key = p.businessPhoneNumberId ?? "N/A";
    (byPhone[key] ??= []).push(p);
  }
  const duplicatePhoneNumbers = Object.entries(byPhone)
    .filter(([, list]) => list.length > 1)
    .map(([phone, list]) => ({ phone, providers: list }));

  return NextResponse.json({
    providers,
    organizations: orgs,
    kanbanColumns,
    duplicatePhoneNumbers,
    counts: { totalLeads, totalConversations, totalMessages },
    escalatedLeads,
    closedLeads,
    ownerNotifications: ownerNotifs,
    last10Messages: recentMsgs,
    audioMessages,
  });
}
