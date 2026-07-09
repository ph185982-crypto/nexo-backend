import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN") {
    throw new Error("Forbidden");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();

    const { id } = await params;
    const body = await req.json();
    const { acao } = body;

    if (acao !== "confirmar") {
      return NextResponse.json({ error: "acao must be 'confirmar'" }, { status: 400 });
    }

    const receita = await prisma.receitaPrevistaMax.findUnique({ where: { id } });
    if (!receita) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const now = new Date();
    const mes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const [updated] = await prisma.$transaction([
      prisma.receitaPrevistaMax.update({
        where: { id },
        data: {
          status: "recebida",
          data_recebimento: now,
        },
      }),
      prisma.transacao.create({
        data: {
          tipo: "receita",
          valor: receita.valor,
          descricao: `Receita: ${receita.descricao}`,
          categoria: "Receita Prevista",
          tipo_negocio: receita.tipo_negocio ?? "pessoal",
          data_transacao: now,
          mes,
        },
      }),
    ]);

    return NextResponse.json(updated);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/receitas/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
