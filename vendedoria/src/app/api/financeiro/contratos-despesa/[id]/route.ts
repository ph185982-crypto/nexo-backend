// PATCH /api/financeiro/contratos-despesa/:id
//   { acao: "editar", ...campos }  → altera o contrato (o novo valor vale para as contas pendentes)
//   { acao: "encerrar" }           → para de gerar e cancela as pendentes que ainda não venceram
//   { acao: "reativar" }           → volta a gerar
// Nada é apagado: tudo passa pelo livro-razão (histórico financeiro).

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { ErroValidacao } from "@/lib/finance/erros";
import { editarContratoDespesa, encerrarContratoDespesa, reativarContratoDespesa } from "@/lib/finance/contratos-despesa";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    switch (body?.acao) {
      case "editar": {
        const { acao: _acao, ...campos } = body; void _acao;
        return NextResponse.json(await editarContratoDespesa(id, campos));
      }
      case "encerrar": return NextResponse.json(await encerrarContratoDespesa(id));
      case "reativar": return NextResponse.json({ geradas: await reativarContratoDespesa(id) });
      default: return NextResponse.json({ error: "acao deve ser 'editar', 'encerrar' ou 'reativar'" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof ErroValidacao) return NextResponse.json({ error: err.message }, { status: err.message.includes("não encontrado") ? 404 : 400 });
    console.error("[financeiro/contratos-despesa PATCH]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
