// GET  /api/financeiro/contratos-despesa → contratos com progresso (pagas, restantes, próxima conta)
// POST /api/financeiro/contratos-despesa → cria o contrato e gera as contas do mês e do seguinte

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { ErroValidacao } from "@/lib/finance/erros";
import { criarContratoDespesa, garantirContasDeContratos, listarContratosDespesa } from "@/lib/finance/contratos-despesa";
import { semearContratosDespesaIniciais } from "@/lib/finance/contratos-despesa-iniciais";

export const maxDuration = 30;

export async function GET() {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  try {
    await semearContratosDespesaIniciais();
    await garantirContasDeContratos();
    return NextResponse.json({ contratos: await listarContratosDespesa() });
  } catch (err) {
    console.error("[financeiro/contratos-despesa GET]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
    const r = await criarContratoDespesa(body);
    return NextResponse.json({ contrato: r.contrato, contasGeradas: r.geradas }, { status: 201 });
  } catch (err) {
    if (err instanceof ErroValidacao) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[financeiro/contratos-despesa POST]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
