// PATCH /api/financeiro/contratos/:id  — { acao: "encerrar", motivo? }
// Encerra o contrato: as parcelas futuras ainda pendentes viram "perdida" (com motivo).
// Nada é apagado — o contrato e todas as parcelas continuam gravados.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { encerrarContrato } from "@/lib/finance/contratos";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body.acao !== "encerrar") {
      return NextResponse.json({ error: "acao deve ser 'encerrar'" }, { status: 400 });
    }
    const r = await encerrarContrato(id, typeof body.motivo === "string" ? body.motivo : null);
    if (!r) return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
    return NextResponse.json(r);
  } catch (err) {
    console.error("[financeiro/contratos/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
