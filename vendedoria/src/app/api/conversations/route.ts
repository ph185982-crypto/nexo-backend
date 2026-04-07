import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const organizationId = searchParams.get("organizationId");
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status") ?? "all"; // all | open | escalated | blocked
  const cursor = searchParams.get("cursor");
  const take = 30;

  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

  const providers = await prisma.whatsappProviderConfig.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const providerIds = providers.map((p) => p.id);

  const leadStatusFilter = status === "all" ? undefined
    : status === "open" ? { status: "OPEN" }
    : status === "escalated" ? { status: "ESCALATED" }
    : status === "blocked" ? { status: "BLOCKED" }
    : undefined;

  const conversations = await prisma.whatsappConversation.findMany({
    where: {
      whatsappProviderConfigId: { in: providerIds },
      ...(search ? {
        OR: [
          { profileName: { contains: search, mode: "insensitive" } },
          { customerWhatsappBusinessId: { contains: search } },
          { lead: { profileName: { contains: search, mode: "insensitive" } } },
        ],
      } : {}),
      ...(leadStatusFilter ? { lead: leadStatusFilter } : {}),
      ...(cursor ? { id: { lt: cursor } } : {}),
    },
    select: {
      id: true,
      customerWhatsappBusinessId: true,
      profileName: true,
      lastMessageAt: true,
      isActive: true,
      humanTakeover: true,
      lead: { select: { id: true, profileName: true, phoneNumber: true, status: true } },
      messages: {
        orderBy: { sentAt: "desc" },
        take: 1,
        select: { content: true, role: true, sentAt: true, type: true },
      },
      followUp: { select: { status: true, step: true, nextSendAt: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: take + 1,
  });

  const hasMore = conversations.length > take;
  const items = hasMore ? conversations.slice(0, take) : conversations;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ conversations: items, nextCursor, hasMore });
}
