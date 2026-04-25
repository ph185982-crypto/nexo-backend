import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

// GET /api/ai/monitor?etapa=NOVO&human=true&take=50
export async function GET(req: NextRequest) {
  try {
    const url     = new URL(req.url);
    const etapa   = url.searchParams.get("etapa") ?? undefined;
    const take    = Math.min(Number(url.searchParams.get("take") ?? "60"), 200);
    const humanOnly = url.searchParams.get("human") === "true";

    const where = {
      isActive: true,
      ...(etapa ? { etapa } : {}),
      ...(humanOnly ? { humanTakeover: true } : {}),
    };

    const [conversations, counts, humanCount] = await Promise.all([
      prisma.whatsappConversation.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        take,
        select: {
          id:                          true,
          profileName:                 true,
          customerWhatsappBusinessId:  true,
          etapa:                       true,
          humanTakeover:               true,
          lastMessageAt:               true,
          createdAt:                   true,
          leadId:                      true,
          followUp: {
            select: { status: true, step: true, nextSendAt: true },
          },
        },
      }),
      prisma.whatsappConversation.groupBy({
        by: ["etapa"],
        where: { isActive: true },
        _count: { _all: true },
      }),
      prisma.whatsappConversation.count({ where: { isActive: true, humanTakeover: true } }),
    ]);

    const total = counts.reduce((s, c) => s + c._count._all, 0);

    return NextResponse.json({ conversations, counts, total, humanCount });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
