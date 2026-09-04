import { NextRequest, NextResponse } from "next/server";
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

    const orcamentos = await prisma.orcamentoMax.findMany({
      orderBy: { categoria: "asc" },
    });

    // Get current month spending per category
    const gastos = await prisma.transacao.groupBy({
      by: ["categoria"],
      where: {
        tipo: "despesa",
        mes: mesAtual,
        categoria: { in: orcamentos.map((o) => o.categoria) },
      },
      _sum: { valor: true },
    });

    const gastoMap = new Map(
      gastos.map((g) => [g.categoria, g._sum.valor ?? 0])
    );

    const result = orcamentos.map((o) => ({
      ...o,
      gasto_atual: gastoMap.get(o.categoria) ?? 0,
    }));

    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/orcamentos GET]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const body = await req.json();
    const { categoria, limite_mensal } = body;

    if (!categoria || limite_mensal == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const orcamento = await prisma.orcamentoMax.upsert({
      where: { categoria },
      create: {
        categoria,
        limite_mensal: Math.round(limite_mensal * 100) / 100,
      },
      update: {
        limite_mensal: Math.round(limite_mensal * 100) / 100,
      },
    });

    return NextResponse.json(orcamento, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/orcamentos POST]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();

    const categoria = new URL(req.url).searchParams.get("categoria");
    if (!categoria) {
      return NextResponse.json({ error: "categoria query param required" }, { status: 400 });
    }

    await prisma.orcamentoMax.delete({ where: { categoria } });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/orcamentos DELETE]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
