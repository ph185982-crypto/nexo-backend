import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

const CONV_SELECT = {
  id: true,
  customerWhatsappBusinessId: true,
  profileName: true,
  lastMessageAt: true,
  isActive: true,
  humanTakeover: true,
  lead: { select: { id: true, profileName: true, phoneNumber: true, status: true } },
  messages: {
    orderBy: { sentAt: "desc" as const },
    take: 1,
    select: { content: true, role: true, sentAt: true, type: true },
  },
  followUp: { select: { status: true, step: true, nextSendAt: true } },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const organizationId = searchParams.get("organizationId");
  const search  = searchParams.get("search") ?? "";
  const status  = searchParams.get("status") ?? "all";
  const cursor  = searchParams.get("cursor");
  const fetchId = searchParams.get("id"); // fetch a single conversation by id
  const take    = 100; // increased from 30

  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

  const providers = await prisma.whatsappProviderConfig.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const providerIds = providers.map((p) => p.id);

  // Single conversation fetch (for when selected conv isn't in the list)
  if (fetchId) {
    const conv = await prisma.whatsappConversation.findFirst({
      where: { id: fetchId, whatsappProviderConfigId: { in: providerIds } },
      select: CONV_SELECT,
    });
    return NextResponse.json({ conversation: conv });
  }

  const leadStatusFilter =
    status === "open"      ? { status: "OPEN" } :
    status === "escalated" ? { status: "ESCALATED" } :
    status === "blocked"   ? { status: "BLOCKED" } :
    status === "closed"    ? { status: "CLOSED" } :
    undefined; // "all" — no filter

  const conversations = await prisma.whatsappConversation.findMany({
    where: {
      whatsappProviderConfigId: { in: providerIds },
      ...(search ? {
        OR: [
          { profileName: { contains: search, mode: "insensitive" } },
          { customerWhatsappBusinessId: { contains: search } },
          { lead: { phoneNumber: { contains: search } } },
          { lead: { profileName: { contains: search, mode: "insensitive" } } },
        ],
      } : {}),
      ...(leadStatusFilter ? { lead: leadStatusFilter } : {}),
      ...(cursor ? { lastMessageAt: { lt: new Date(cursor) } } : {}),
    },
    select: CONV_SELECT,
    orderBy: { lastMessageAt: "desc" },
    take: take + 1,
  });

  const hasMore = conversations.length > take;
  const items   = hasMore ? conversations.slice(0, take) : conversations;
  const nextCursor = hasMore ? (items[items.length - 1].lastMessageAt?.toISOString() ?? null) : null;

  return NextResponse.json({ conversations: items, nextCursor, hasMore });
}
