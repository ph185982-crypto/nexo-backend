import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN") {
    throw new Error("Forbidden");
  }
}

export async function GET() {
  try {
    await requireAdmin();

    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
    );
    const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Build last 6 months list
    const meses: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      meses.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      );
    }

    // Current month aggregates
    const [receitasAgg, despesasAgg] = await Promise.all([
      prisma.transacao.aggregate({
        where: { mes: mesAtual, tipo: "receita" },
        _sum: { valor: true },
      }),
      prisma.transacao.aggregate({
        where: { mes: mesAtual, tipo: "despesa" },
        _sum: { valor: true },
      }),
    ]);

    const receitas = receitasAgg._sum.valor ?? 0;
    const despesas = despesasAgg._sum.valor ?? 0;
    const saldo = receitas - despesas;

    // Meta
    const metaDb = await prisma.metaFinanceiraMax.findFirst({
      where: { tipo: "mensal", status: "ativa" },
      orderBy: { criado_em: "desc" },
    });
    const meta = { alvo: metaDb?.valor_alvo ?? 8000, atual: receitas };

    // Top 8 expense categories this month
    const categoriasRaw = await prisma.transacao.groupBy({
      by: ["categoria"],
      where: { tipo: "despesa", mes: mesAtual },
      _sum: { valor: true },
      orderBy: { _sum: { valor: "desc" } },
      take: 8,
    });
    const categorias = categoriasRaw.map((c) => ({
      categoria: c.categoria,
      total: c._sum.valor ?? 0,
    }));

    // Monthly data for last 6 months
    const mensal = await Promise.all(
      meses.map(async (mes) => {
        const [rec, desp] = await Promise.all([
          prisma.transacao.aggregate({
            where: { mes, tipo: "receita" },
            _sum: { valor: true },
          }),
          prisma.transacao.aggregate({
            where: { mes, tipo: "despesa" },
            _sum: { valor: true },
          }),
        ]);
        return {
          mes,
          receitas: rec._sum.valor ?? 0,
          despesas: desp._sum.valor ?? 0,
        };
      })
    );

    return NextResponse.json({
      receitas,
      despesas,
      saldo,
      meta,
      categorias,
      mensal,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/overview]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
