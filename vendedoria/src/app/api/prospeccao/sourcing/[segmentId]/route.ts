import { NextRequest, NextResponse } from "next/server";
import { buscarLeadsPorSegmento } from "@/lib/prospeccao/sourcing";

// POST /api/prospeccao/sourcing/:segmentId — dispara busca no Google Places
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const { segmentId } = await params;
  try {
    const result = await buscarLeadsPorSegmento(segmentId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
