import { NextRequest, NextResponse } from "next/server";
import { sugerirAjustePesos } from "@/lib/prospeccao/analise-pesos";

// GET /api/prospeccao/sugestao-pesos/:segmentId
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const { segmentId } = await params;

  const sugestoes = await sugerirAjustePesos(segmentId);

  if (sugestoes === null) {
    return NextResponse.json(
      { erro: "Dados insuficientes — necessário pelo menos 30 leads com desfecho final para gerar sugestão." },
      { status: 422 },
    );
  }

  return NextResponse.json({ segmentId, sugestoes });
}
