import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isMaxOwnerNumber } from "@/lib/max/config";

/**
 * TEMPORARY — one-off read-only report for Pedro's "quem é o público / quais
 * dores relatadas" question. Same admin-session auth as every other CRM API
 * route — no secret to leak. DELETE THIS FILE after the report is generated.
 */
export async function GET(_req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgs = await prisma.whatsappBusinessOrganization.findMany({
    select: { id: true, name: true, tipo: true },
  });

  const orgSummaries = [];
  const allSamples: Array<{ org: string; at: string; lead: string; content: string }> = [];

  for (const org of orgs) {
    const providerIds = (
      await prisma.whatsappProviderConfig.findMany({ where: { organizationId: org.id }, select: { id: true } })
    ).map((p) => p.id);
    if (providerIds.length === 0) continue;

    const [totalLeads, first, last, totalUserMsgs] = await Promise.all([
      prisma.lead.count({ where: { organizationId: org.id } }),
      prisma.whatsappMessage.findFirst({
        where: { role: "USER", conversation: { whatsappProviderConfigId: { in: providerIds } } },
        orderBy: { sentAt: "asc" },
        select: { sentAt: true },
      }),
      prisma.whatsappMessage.findFirst({
        where: { role: "USER", conversation: { whatsappProviderConfigId: { in: providerIds } } },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      }),
      prisma.whatsappMessage.count({
        where: { role: "USER", conversation: { whatsappProviderConfigId: { in: providerIds } } },
      }),
    ]);

    orgSummaries.push({
      org: org.name,
      tipo: org.tipo,
      totalLeads,
      totalUserMsgs,
      firstMessageAt: first?.sentAt ?? null,
      lastMessageAt: last?.sentAt ?? null,
    });

    if (totalUserMsgs === 0) continue;

    // Exclui o próprio número do Pedro (conversas com o Max, roteadas por esse
    // mesmo provider antes de chegar no SDR) — não é "público", é ruído.
    const msgs = (await prisma.whatsappMessage.findMany({
      where: { role: "USER", conversation: { whatsappProviderConfigId: { in: providerIds } } },
      orderBy: { sentAt: "asc" },
      select: {
        sentAt: true,
        content: true,
        conversation: { select: { profileName: true, customerWhatsappBusinessId: true } },
      },
    })).filter((m) => !isMaxOwnerNumber(m.conversation.customerWhatsappBusinessId));

    // Amostra distribuída no tempo (índices igualmente espaçados do primeiro
    // ao último) — cobre do início até agora, não só os mais antigos.
    const CAP = 600;
    const n = msgs.length;
    const picked = n <= CAP
      ? msgs
      : Array.from({ length: CAP }, (_, k) => msgs[Math.floor((k * (n - 1)) / (CAP - 1))]);

    for (const m of picked) {
      allSamples.push({
        org: org.name,
        at: m.sentAt.toISOString(),
        lead: m.conversation.profileName ?? m.conversation.customerWhatsappBusinessId,
        content: m.content.slice(0, 240),
      });
    }
  }

  return NextResponse.json({ orgSummaries, samples: allSamples });
}
