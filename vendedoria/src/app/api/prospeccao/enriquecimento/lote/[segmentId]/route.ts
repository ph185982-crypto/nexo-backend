import { NextRequest, NextResponse } from "next/server";
import { enriquecerLote } from "@/lib/prospeccao/enriquecimento";
import { calcularScoreLote } from "@/lib/prospeccao/score";

// POST /api/prospeccao/enriquecimento/lote/:segmentId
// Processa todos os leads NOVO do segmento: enriquece + calcula score
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const { segmentId } = await params;
  try {
    const enriq = await enriquecerLote(segmentId);
    const score = await calcularScoreLote(segmentId);
    return NextResponse.json({ ok: true, enriquecimento: enriq, scoring: score });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
