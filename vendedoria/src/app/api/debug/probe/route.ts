import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET() {
  const [leads, messages, conversations] = await Promise.all([
    prisma.lead.count(),
    prisma.whatsappMessage.count(),
    prisma.whatsappConversation.count(),
  ]);
  const lastMessages = await prisma.whatsappMessage.findMany({
    orderBy: { sentAt: "desc" },
    take: 5,
    select: { role: true, content: true, sentAt: true, status: true },
  });
  return NextResponse.json({ leads, messages, conversations, lastMessages });
}
