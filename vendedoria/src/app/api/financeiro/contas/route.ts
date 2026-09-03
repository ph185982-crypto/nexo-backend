import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN") {
    throw new Error("Forbidden");
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const status = new URL(req.url).searchParams.get("status");
    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const contas = await prisma.contaPagarMax.findMany({
      where,
      orderBy: { data_vencimento: "asc" },
    });

    return NextResponse.json(contas);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/contas GET]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const body = await req.json();
    const {
      descricao,
      valor,
      data_vencimento,
      categoria,
      tipo_negocio,
      recorrente,
      frequencia,
    } = body;

    if (!descricao || valor == null || !data_vencimento) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const conta = await prisma.contaPagarMax.create({
      data: {
        descricao,
        valor: Math.round(valor * 100) / 100,
        data_vencimento: new Date(data_vencimento),
        categoria: categoria ?? "Outros",
        tipo_negocio: tipo_negocio ?? "pessoal",
        recorrente: recorrente ?? false,
        frequencia: frequencia ?? null,
      },
    });

    return NextResponse.json(conta, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/contas POST]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
