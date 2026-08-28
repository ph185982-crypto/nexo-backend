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
  if (!name) return NextResponse.json({ error: "name obrigatório" }, { status: 400 });

  const leads = await prisma.lead.findMany({
    where: { profileName: { contains: name, mode: "insensitive" } },
    select: {
      id: true, profileName: true, phoneNumber: true, status: true,
      organizationId: true, createdAt: true, lastActivityAt: true,
      organization: { select: { name: true, tipo: true } },
      kanbanColumn: { select: { name: true, type: true } },
      conversations: {
        select: {
          id: true, isActive: true, humanTakeover: true, lastMessageAt: true,
          etapa: true,
          provider: { select: { businessPhoneNumberId: true, agent: { select: { systemPrompt: true, kind: true, status: true } } } },
        },
      },
    },
  });

  return NextResponse.json({
    count: leads.length,
    leads: leads.map((l) => ({
      ...l,
      conversations: l.conversations.map((c) => ({
        ...c,
        provider: {
          ...c.provider,
          agent: c.provider?.agent
            ? { ...c.provider.agent, isSdr: c.provider.agent.systemPrompt?.trimStart().startsWith("[SDR]") ?? false, systemPrompt: undefined }
            : null,
        },
      })),
    })),
  });
}
