import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { exigirAcesso } from "@/lib/prospeccao/guard";

// POST /api/prospeccao/aprovar-lote/:segmentId
// Aprova em lote todos os leads do segmento com status NOVO, ENRIQUECIDO, PONTUADO ou ANALISADO
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { segmentId } = await params;

  const result = await prisma.prospectLead.updateMany({
    where: {
      segmentId,
      status: { in: ["NOVO", "ENRIQUECIDO", "PONTUADO", "ANALISADO"] },
    },
    data: { status: "APROVADO" },
  });

  return NextResponse.json({ ok: true, aprovados: result.count });
}
