import { NextRequest, NextResponse } from "next/server";
import { enriquecerLead } from "@/lib/prospeccao/enriquecimento";

// POST /api/prospeccao/enriquecimento/:leadId
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await params;
  try {
    await enriquecerLead(leadId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
