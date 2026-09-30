// POST /api/financeiro/historico/:id/restaurar — recria um lançamento excluído.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { restaurarDoHistorico } from "@/lib/finance/restaurar";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const r = await restaurarDoHistorico(id);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
    return NextResponse.json(r);
  } catch (err) {
    console.error("[financeiro/historico/restaurar]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
