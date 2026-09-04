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

    const allowedFields = [
      "tipo",
      "valor",
      "descricao",
      "categoria",
      "tipo_negocio",
      "data_transacao",
      "empresa",
      "confirmado",
    ];

    const data: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        data[field] = body[field];
      }
    }

    if (data.valor != null) {
      data.valor = Math.round((data.valor as number) * 100) / 100;
    }

    if (data.data_transacao) {
      const dt = new Date(data.data_transacao as string);
      data.data_transacao = dt;
      data.mes = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    }

    const transacao = await prisma.transacao.update({
      where: { id },
      data,
    });

    return NextResponse.json(transacao);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/transacoes/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();

    const { id } = await params;

    await prisma.transacao.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/transacoes/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
