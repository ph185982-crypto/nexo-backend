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

    const receitas = await prisma.receitaPrevistaMax.findMany({
      orderBy: { data_prevista: "asc" },
    });

    return NextResponse.json(receitas);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/receitas GET]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const body = await req.json();
    const { descricao, valor, data_prevista, tipo_negocio, cliente, observacao } = body;

    if (!descricao || valor == null || !data_prevista) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const receita = await prisma.receitaPrevistaMax.create({
      data: {
        descricao,
        valor: Math.round(valor * 100) / 100,
        data_prevista: new Date(data_prevista),
        tipo_negocio: tipo_negocio ?? null,
        cliente: cliente ?? null,
        observacao: observacao ?? null,
      },
    });

    return NextResponse.json(receita, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/receitas POST]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
