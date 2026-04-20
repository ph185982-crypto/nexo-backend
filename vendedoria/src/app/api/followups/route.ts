import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const organizationId = searchParams.get("organizationId");

  const where = {
    status: "ACTIVE" as const,
    ...(organizationId
      ? {
          conversation: {
            lead: { organizationId },
          },
        }
      : {}),
  };

  const followups = await prisma.conversationFollowUp.findMany({
    where,
    orderBy: { nextSendAt: "asc" },
    take: 100,
    include: {
      conversation: {
        select: {
          id: true,
          profileName: true,
          customerWhatsappBusinessId: true,
          lead: {
            select: { id: true, phoneNumber: true, profileName: true },
          },
        },
      },
    },
  });

  return NextResponse.json(
    followups.map((f) => ({
      id: f.id,
      step: f.step,
      status: f.status,
      leadName: f.leadName ?? f.conversation.profileName ?? f.conversation.customerWhatsappBusinessId,
      phoneNumber: f.phoneNumber,
      nextSendAt: f.nextSendAt.toISOString(),
      aiMessageAt: f.aiMessageAt.toISOString(),
      conversationId: f.conversationId,
      leadId: f.conversation.lead?.id ?? null,
    }))
  );
}
