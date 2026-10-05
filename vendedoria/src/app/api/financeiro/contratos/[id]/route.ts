// PATCH /api/financeiro/contratos/:id
//   { acao: "editar", valor_parcela?, valor_total?, descricao?, cliente?, observacao?, a_partir_de? }
//     → edita o contrato e as parcelas EM ABERTO (recebidas/perdidas nunca mudam)
//   { acao: "encerrar", motivo? }
// Encerra o contrato: as parcelas futuras ainda pendentes viram "perdida" (com motivo).
// Nada é apagado — o contrato e todas as parcelas continuam gravados.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { ErroValidacao } from "@/lib/finance/erros";
import { editarContrato, encerrarContrato } from "@/lib/finance/contratos";

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
    if (body.acao === "editar") {
      const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
      const txt = (v: unknown) => (typeof v === "string" ? v : undefined);
      const r = await editarContrato(id, {
        descricao: txt(body.descricao),
        cliente: body.cliente === null ? null : txt(body.cliente),
        observacao: body.observacao === null ? null : txt(body.observacao),
        valor_parcela: num(body.valor_parcela),
        valor_total: num(body.valor_total),
        a_partir_de: txt(body.a_partir_de) || undefined,
      });
      if (!r) return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
      return NextResponse.json(r);
    }
    if (body.acao !== "encerrar") {
      return NextResponse.json({ error: "acao deve ser 'editar' ou 'encerrar'" }, { status: 400 });
    }
    const r = await encerrarContrato(id, typeof body.motivo === "string" ? body.motivo : null);
    if (!r) return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof ErroValidacao) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[financeiro/contratos/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
