import { NextRequest, NextResponse } from "next/server";
import { analisarLote } from "@/lib/prospeccao/agente-analista";
import { exigirAcesso } from "@/lib/prospeccao/guard";

export const maxDuration = 60;

// POST /api/prospeccao/analise/lote/:segmentId
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { segmentId } = await params;
  try {
    const result = await analisarLote(segmentId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
