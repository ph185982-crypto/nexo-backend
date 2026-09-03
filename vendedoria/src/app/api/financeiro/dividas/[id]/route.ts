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
    const { acao, valor } = body;

    if (!acao || !["pagar_parcela", "quitar"].includes(acao)) {
      return NextResponse.json(
        { error: "acao must be 'pagar_parcela' or 'quitar'" },
        { status: 400 }
      );
    }

    const divida = await prisma.dividaMax.findUnique({ where: { id } });
    if (!divida) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (acao === "quitar") {
      const updated = await prisma.dividaMax.update({
        where: { id },
        data: { status: "quitada", valor_pago: divida.valor_total },
      });
      return NextResponse.json(updated);
    }

    // acao === "pagar_parcela"
    if (valor == null || valor <= 0) {
      return NextResponse.json({ error: "valor is required and must be positive" }, { status: 400 });
    }

    const valorParcela = Math.round(valor * 100) / 100;
    const novoValorPago = Math.round((divida.valor_pago + valorParcela) * 100) / 100;
    const now = new Date();
    const mes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const [updated] = await prisma.$transaction([
      prisma.dividaMax.update({
        where: { id },
        data: {
          valor_pago: novoValorPago,
          status: novoValorPago >= divida.valor_total ? "quitada" : "ativa",
        },
      }),
      prisma.transacao.create({
        data: {
          tipo: "despesa",
          valor: valorParcela,
          descricao: `Parcela: ${divida.descricao}`,
          categoria: "Dividas/Parcelas",
          tipo_negocio: "pessoal",
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
    console.error("[financeiro/dividas/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
