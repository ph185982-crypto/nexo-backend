// GET /api/financeiro/dre
//   ?mes=YYYY-MM | ?dia=YYYY-MM-DD | ?de=YYYY-MM-DD&ate=YYYY-MM-DD   (padrão: mês corrente)
//   &escopo=todos|nexo|pessoal                                       (padrão: todos)
//
// DRE gerencial em regime de caixa (o que está no extrato), com o período
// anterior para comparação, os últimos 12 meses, o acumulado do ano, o modo
// projetado (receitas previstas em aberto + contas a pagar pendentes) e a
// classificação de cada categoria. Só leitura.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getBrasiliaDateOnly } from "@/lib/max/config";
import { parseEscopo } from "@/lib/finance/escopo";
import { resolverPeriodo } from "@/lib/finance/periodo";
import { montarRelatorioDre } from "@/lib/finance/dre-dados";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const sp = req.nextUrl.searchParams;
    const hoje = getBrasiliaDateOnly();
    const periodo = resolverPeriodo({ mes: sp.get("mes"), dia: sp.get("dia"), de: sp.get("de"), ate: sp.get("ate") }, hoje);
    const escopo = parseEscopo(sp.get("escopo"));
    return NextResponse.json(await montarRelatorioDre(periodo, escopo, hoje));
  } catch (err) {
    console.error("[financeiro/dre]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
