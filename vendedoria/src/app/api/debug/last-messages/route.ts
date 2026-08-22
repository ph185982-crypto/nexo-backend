import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.DEBUG_DIAG_SECRET2 || secret !== process.env.DEBUG_DIAG_SECRET2) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const messages = await prisma.whatsappMessage.findMany({
    orderBy: { sentAt: "desc" },
    take: 10,
    select: {
      id: true,
      content: true,
      role: true,
      sentAt: true,
      status: true,
      conversationId: true,
      conversation: {
        select: {
          id: true,
          humanTakeover: true,
          provider: { select: { id: true } },
          lead: { select: { phoneNumber: true, status: true } },
        },
      },
    },
  });

  const conversations = await prisma.whatsappConversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      id: true,
      updatedAt: true,
      humanTakeover: true,
      lead: { select: { phoneNumber: true, status: true } },
      provider: { select: { businessPhoneNumberId: true, agent: { select: { id: true, status: true } } } },
    },
  });

  return NextResponse.json({ messages, conversations });
}
