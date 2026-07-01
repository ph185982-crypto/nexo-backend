import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

interface PesosBody {
  pesoSemSite?: number;
  pesoSemAnuncioAtivo?: number;
  pesoInstagramParado?: number;
  pesoRatingBaixo?: number;
  limiarScoreQualificado?: number;
}

// POST /api/prospeccao/aplicar-pesos/:segmentId
// Aplica manualmente os pesos sugeridos (ou qualquer valor informado).
// Nunca automático — requer aprovação humana explícita.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const { segmentId } = await params;
  const body = await req.json() as PesosBody;

  const updateData: PesosBody = {};
  if (body.pesoSemSite !== undefined)          updateData.pesoSemSite = body.pesoSemSite;
  if (body.pesoSemAnuncioAtivo !== undefined)  updateData.pesoSemAnuncioAtivo = body.pesoSemAnuncioAtivo;
  if (body.pesoInstagramParado !== undefined)  updateData.pesoInstagramParado = body.pesoInstagramParado;
  if (body.pesoRatingBaixo !== undefined)      updateData.pesoRatingBaixo = body.pesoRatingBaixo;
  if (body.limiarScoreQualificado !== undefined) updateData.limiarScoreQualificado = body.limiarScoreQualificado;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ erro: "Nenhum peso informado" }, { status: 400 });
  }

  const segment = await prisma.prospectSegment.update({
    where: { id: segmentId },
    data: updateData,
  });

  return NextResponse.json({ ok: true, segment });
}
