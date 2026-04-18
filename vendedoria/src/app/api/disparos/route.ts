import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

export const maxDuration = 60;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { organizationId, phoneNumberId, leadIds, message } = body as {
    organizationId?: string;
    phoneNumberId?: string;
    leadIds?: string[];
    message?: string;
  };

  if (!organizationId || !phoneNumberId || !message?.trim() || !leadIds?.length) {
    return NextResponse.json(
      { error: "organizationId, phoneNumberId, leadIds e message são obrigatórios" },
      { status: 400 }
    );
  }

  // Safety cap: max 200 recipients per disparo
  const ids = leadIds.slice(0, 200);

  const leads = await prisma.lead.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true, phoneNumber: true, profileName: true },
  });

  const results: Array<{
    leadId: string;
    phone: string;
    name: string | null;
    status: "sent" | "failed";
    error?: string;
  }> = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const personalized = message.trim()
      .replace(/\{nome\}/gi, lead.profileName ?? lead.phoneNumber)
      .replace(/\{telefone\}/gi, lead.phoneNumber);
    try {
      await sendWhatsAppMessage(phoneNumberId, lead.phoneNumber, personalized);
      results.push({ leadId: lead.id, phone: lead.phoneNumber, name: lead.profileName, status: "sent" });
    } catch (e) {
      results.push({
        leadId: lead.id,
        phone: lead.phoneNumber,
        name: lead.profileName,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    // ~5 messages/sec to stay within Meta rate limits
    if (i < leads.length - 1) await sleep(200);
  }

  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return NextResponse.json({ ok: true, sent, failed, total: leads.length, results });
}
