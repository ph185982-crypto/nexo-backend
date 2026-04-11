import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

const CONV_SELECT = {
  id: true,
  customerWhatsappBusinessId: true,
  profileName: true,
  lastMessageAt: true,
  isActive: true,
  humanTakeover: true,
  etapa: true,
  localizacaoRecebida: true,
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
  const take    = 250;

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

  // Build status-based where clause
  // "hot" = conversations where location was received or etapa is advanced (near-close)
  const statusWhere =
    status === "open"      ? { lead: { status: "OPEN" } } :
    status === "escalated" ? { lead: { status: "ESCALATED" } } :
    status === "blocked"   ? { lead: { status: "BLOCKED" } } :
    status === "closed"    ? { lead: { status: "CLOSED" } } :
    status === "hot"       ? {
      OR: [
        { localizacaoRecebida: true },
        { etapa: { in: ["NEGOCIANDO", "COLETANDO_DADOS", "PEDIDO_CONFIRMADO"] } },
      ],
    } :
    {}; // "all" — no filter

  // Build search OR clauses — handle phone numbers with formatting like "(61) 9044-2728"
  const searchOR = (() => {
    if (!search) return null;
    const digitsOnly = search.replace(/\D/g, "");
    const isPhone    = digitsOnly.length >= 8;

    // All phone variants to try: raw search + digits + with/without BR country code 55
    const phoneVariants = isPhone ? Array.from(new Set([
      digitsOnly,
      ...(digitsOnly.startsWith("55") && digitsOnly.length > 10 ? [digitsOnly.slice(2)] : []),
      ...(!digitsOnly.startsWith("55") ? ["55" + digitsOnly] : []),
    ])) : [];

    return [
      { profileName:                { contains: search, mode: "insensitive" as const } },
      { customerWhatsappBusinessId: { contains: search, mode: "insensitive" as const } },
      { lead: { phoneNumber:   { contains: search } } },
      { lead: { profileName:   { contains: search, mode: "insensitive" as const } } },
      // Digits-only variants so "(61) 9044-2728" → "6190442728" matches "556190442728"
      ...phoneVariants.flatMap(v => [
        { customerWhatsappBusinessId: { contains: v } },
        { lead: { phoneNumber: { contains: v } } },
      ]),
    ];
  })();

  const conversations = await prisma.whatsappConversation.findMany({
    where: {
      whatsappProviderConfigId: { in: providerIds },
      ...(searchOR ? { OR: searchOR } : {}),
      ...statusWhere,
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
