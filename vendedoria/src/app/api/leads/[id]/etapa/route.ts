import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { etapa } = await req.json() as { etapa: string };

    // Update conversation etapa (etapa lives on WhatsappConversation, not Lead)
    const conv = await prisma.whatsappConversation.findFirst({
      where: { leadId: id },
      orderBy: { lastMessageAt: "desc" },
    });

    if (conv) {
      await prisma.whatsappConversation.update({
        where: { id: conv.id },
        data: { etapa },
      });
    }

    return NextResponse.json({ ok: true, etapa });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
