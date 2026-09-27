import { NextRequest, NextResponse } from "next/server";
import { exigirAcesso } from "@/lib/prospeccao/guard";
import { contarPendentes, processarPipeline } from "@/lib/prospeccao/pipeline";

export const maxDuration = 60;

// POST /api/prospeccao/pipeline/:segmentId
// Qualifica as empresas pendentes da busca (enriquecer → pontuar → IA) por até
// ~45s e devolve `restantes`. O cliente repete enquanto restantes.total > 0.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { segmentId } = await params;
  try {
    const resultado = await processarPipeline(segmentId, 45_000);
    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// GET /api/prospeccao/pipeline/:segmentId — quantas empresas faltam qualificar
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { segmentId } = await params;
  return NextResponse.json({ restantes: await contarPendentes(segmentId) });
}
