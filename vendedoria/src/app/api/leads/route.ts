import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const organizationId = searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

  const leads = await prisma.lead.findMany({
    where: { organizationId },
    include: {
      kanbanColumn: true,
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 1,
        select: {
          id: true, etapa: true, produtoInteresse: true,
          localizacaoRecebida: true, humanTakeover: true,
          lastMessageAt: true, foraAreaEntrega: true,
        },
      },
      tags: { include: { tag: true } },
    },
    orderBy: { lastActivityAt: "desc" },
  });

  return NextResponse.json(leads);
}
