import { NextRequest, NextResponse } from "next/server";
import { enriquecerLead } from "@/lib/prospeccao/enriquecimento";
import { exigirAcesso } from "@/lib/prospeccao/guard";

// POST /api/prospeccao/enriquecimento/:leadId
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { leadId } = await params;
  try {
    await enriquecerLead(leadId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
