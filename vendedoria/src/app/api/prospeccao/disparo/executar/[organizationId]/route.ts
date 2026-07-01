import { NextRequest, NextResponse } from "next/server";
import { executarDisparoDiario } from "@/lib/prospeccao/disparo";

// POST /api/prospeccao/disparo/executar/:organizationId
// Dispara manualmente uma rodada para a organização (útil para testes antes de automatizar via cron)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;

  const resultado = await executarDisparoDiario(organizationId);

  return NextResponse.json({ ok: true, resultado });
}
