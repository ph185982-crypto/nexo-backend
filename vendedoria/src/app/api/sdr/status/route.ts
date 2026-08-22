import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET() {
  const org = await prisma.whatsappBusinessOrganization.findFirst({
    where: { tipo: "PROSPECCAO" },
    include: {
      accounts: {
        include: { agent: { select: { id: true, displayName: true, status: true, aiProvider: true, aiModel: true } } },
      },
    },
  });

  if (!org) return NextResponse.json({ ok: false, error: "Org SDR não encontrada no banco" });

  const provider = org.accounts[0];
  return NextResponse.json({
    ok: true,
    orgId: org.id,
    orgStatus: org.status,
    providerId: provider?.id,
    phoneNumberId: provider?.businessPhoneNumberId,
    agentId: provider?.agent?.id,
    agentStatus: provider?.agent?.status,
    aiProvider: provider?.agent?.aiProvider,
    aiModel: provider?.agent?.aiModel,
  });
}
