import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const organizationId = searchParams.get("organizationId");
  const period = searchParams.get("period") ?? "30d"; // 7d | 30d | all

  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

  const since = period === "all" ? undefined : new Date(
    Date.now() - (period === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000
  );
  const dateFilter = since ? { gte: since } : undefined;

  // All provider configs for this org
  const providers = await prisma.whatsappProviderConfig.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const providerIds = providers.map((p) => p.id);

  const [
    totalConversations,
    activeConversations,
    totalMessages,
    aiMessages,
    orders,        // PASSAGEM notifications = closed orders
    escalations,
    optOuts,
    avgResponseTime,
    followUpsActive,
    followUpsDone,
  ] = await Promise.all([
    // Total conversations
    prisma.whatsappConversation.count({
      where: { whatsappProviderConfigId: { in: providerIds }, ...(dateFilter ? { createdAt: dateFilter } : {}) },
    }),
    // Active (replied in last 48h)
    prisma.whatsappConversation.count({
      where: {
        whatsappProviderConfigId: { in: providerIds },
        lastMessageAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      },
    }),
    // Total messages
    prisma.whatsappMessage.count({
      where: {
        conversation: { whatsappProviderConfigId: { in: providerIds } },
        ...(dateFilter ? { sentAt: dateFilter } : {}),
      },
    }),
    // AI messages only
    prisma.whatsappMessage.count({
      where: {
        conversation: { whatsappProviderConfigId: { in: providerIds } },
        role: "ASSISTANT",
        ...(dateFilter ? { sentAt: dateFilter } : {}),
      },
    }),
    // Orders handed off
    prisma.ownerNotification.count({
      where: { organizationId, type: "ORDER", ...(dateFilter ? { createdAt: dateFilter } : {}) },
    }),
    // Escalations
    prisma.ownerNotification.count({
      where: { organizationId, type: "ESCALATION", ...(dateFilter ? { createdAt: dateFilter } : {}) },
    }),
    // Opt-outs (blocked leads)
    prisma.lead.count({
      where: { organizationId, status: "BLOCKED", ...(dateFilter ? { updatedAt: dateFilter } : {}) },
    }),
    // Average AI response time (ms) — sample last 200 AI messages
    prisma.whatsappMessage.findMany({
      where: {
        conversation: { whatsappProviderConfigId: { in: providerIds } },
        role: "ASSISTANT",
        ...(dateFilter ? { sentAt: dateFilter } : {}),
      },
      orderBy: { sentAt: "desc" },
      take: 200,
      select: { sentAt: true, conversationId: true },
    }),
    // Follow-ups active
    prisma.conversationFollowUp.count({
      where: { conversation: { whatsappProviderConfigId: { in: providerIds } }, status: "ACTIVE" },
    }),
    // Follow-ups completed
    prisma.conversationFollowUp.count({
      where: { conversation: { whatsappProviderConfigId: { in: providerIds } }, status: "DONE" },
    }),
  ]);

  // Compute avg response time from AI messages
  let avgMs = 0;
  if (Array.isArray(avgResponseTime) && avgResponseTime.length > 0) {
    const convIds = [...new Set(avgResponseTime.map((m) => m.conversationId))];
    const userMessages = await prisma.whatsappMessage.findMany({
      where: { conversationId: { in: convIds }, role: "USER" },
      orderBy: { sentAt: "asc" },
      select: { sentAt: true, conversationId: true },
    });

    const userMsgMap: Record<string, Date[]> = {};
    for (const m of userMessages) {
      if (!userMsgMap[m.conversationId]) userMsgMap[m.conversationId] = [];
      userMsgMap[m.conversationId].push(m.sentAt);
    }

    const deltas: number[] = [];
    for (const aiMsg of avgResponseTime) {
      const userMsgs = userMsgMap[aiMsg.conversationId] ?? [];
      const prev = userMsgs.filter((d) => d < aiMsg.sentAt).pop();
      if (prev) deltas.push(aiMsg.sentAt.getTime() - prev.getTime());
    }
    if (deltas.length > 0) avgMs = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
  }

  // Conversion rate = orders / totalConversations
  const conversionRate = totalConversations > 0
    ? Math.round((orders / totalConversations) * 100 * 10) / 10
    : 0;

  return NextResponse.json({
    period,
    totalConversations,
    activeConversations,
    totalMessages,
    aiMessages,
    orders,
    escalations,
    optOuts,
    followUpsActive,
    followUpsDone,
    conversionRate,
    avgResponseTimeMs: avgMs,
    avgResponseTimeSec: Math.round(avgMs / 1000),
  });
}
