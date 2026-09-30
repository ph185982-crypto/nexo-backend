// GET /api/financeiro/contratos — contratos de receita com o andamento das parcelas.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";
import { garantirParcelasContratos } from "@/lib/finance/contratos";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await garantirParcelasContratos();

    const [contratos, grupos] = await Promise.all([
      prisma.contratoReceita.findMany({ orderBy: [{ status: "asc" }, { criado_em: "desc" }] }),
      prisma.receitaPrevistaMax.groupBy({
        by: ["contrato_id", "status"],
        where: { contrato_id: { not: null } },
        _count: { _all: true },
        _sum: { valor: true },
      }),
    ]);

    const itens = contratos.map((c) => {
      const g = grupos.filter((x) => x.contrato_id === c.id);
      const por = (...st: string[]) => {
        const sel = g.filter((x) => st.includes(x.status));
        return {
          quantidade: sel.reduce((s, x) => s + x._count._all, 0),
          total: Math.round(sel.reduce((s, x) => s + (x._sum.valor ?? 0), 0) * 100) / 100,
        };
      };
      return {
        ...c,
        parcelas: {
          recebidas: por("recebida"),
          abertas: por("pendente", "atrasada"),
          perdidas: por("perdida"),
        },
      };
    });

    return NextResponse.json({ contratos: itens });
  } catch (err) {
    console.error("[financeiro/contratos GET]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
