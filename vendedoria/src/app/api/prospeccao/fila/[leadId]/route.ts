import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { exigirAcesso } from "@/lib/prospeccao/guard";

// PATCH /api/prospeccao/fila/:leadId
// body: { action: "aprovar" | "descartar" }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { leadId } = await params;
  const { action } = await req.json() as { action: string };

  if (action !== "aprovar" && action !== "descartar") {
    return NextResponse.json({ error: "action deve ser 'aprovar' ou 'descartar'" }, { status: 400 });
  }

  const novoStatus = action === "aprovar" ? "APROVADO" : "DESCARTADO";

  await prisma.prospectLead.update({
    where: { id: leadId },
    data: { status: novoStatus },
  });

  return NextResponse.json({ ok: true, status: novoStatus });
}
