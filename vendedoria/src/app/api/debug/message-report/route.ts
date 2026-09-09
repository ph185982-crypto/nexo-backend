import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";

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

    // Amostra distribuída no tempo (não só as últimas) pra cobrir do início até agora.
    const CAP = 500;
    const skipStep = Math.max(1, Math.floor(totalUserMsgs / CAP));
    const msgs = await prisma.whatsappMessage.findMany({
      where: { role: "USER", conversation: { whatsappProviderConfigId: { in: providerIds } } },
      orderBy: { sentAt: "asc" },
      select: {
        sentAt: true,
        content: true,
        conversation: { select: { profileName: true, customerWhatsappBusinessId: true } },
      },
    });

    for (let i = 0; i < msgs.length; i += skipStep) {
      const m = msgs[i];
      allSamples.push({
        org: org.name,
        at: m.sentAt.toISOString(),
        lead: m.conversation.profileName ?? m.conversation.customerWhatsappBusinessId,
        content: m.content.slice(0, 240),
      });
      if (allSamples.length >= CAP * orgs.length) break;
    }
  }

  return NextResponse.json({ orgSummaries, samples: allSamples });
}
