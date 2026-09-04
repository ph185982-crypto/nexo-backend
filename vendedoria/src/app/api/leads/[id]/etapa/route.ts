import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";

const ETAPAS_VALIDAS = [
  "NOVO", "PRODUTO_IDENTIFICADO", "QUALIFICANDO", "NEGOCIANDO",
  "COLETANDO_DADOS", "PEDIDO_CONFIRMADO", "PERDIDO",
];

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const { etapa } = await req.json() as { etapa: string };

    if (!ETAPAS_VALIDAS.includes(etapa)) {
      return NextResponse.json(
        { error: `etapa invalida. Use uma de: ${ETAPAS_VALIDAS.join(", ")}` },
        { status: 400 },
      );
    }

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
    if (e instanceof Error && e.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
