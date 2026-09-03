import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN") {
    throw new Error("Forbidden");
  }
}

function addFrequency(date: Date, frequencia: string): Date {
  const next = new Date(date);
  switch (frequencia) {
    case "semanal":
      next.setDate(next.getDate() + 7);
      break;
    case "anual":
      next.setFullYear(next.getFullYear() + 1);
      break;
    case "mensal":
    default:
      next.setMonth(next.getMonth() + 1);
      break;
  }
  return next;
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

    if (!acao || !["pagar", "cancelar"].includes(acao)) {
      return NextResponse.json({ error: "acao must be 'pagar' or 'cancelar'" }, { status: 400 });
    }

    const conta = await prisma.contaPagarMax.findUnique({ where: { id } });
    if (!conta) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (acao === "cancelar") {
      const updated = await prisma.contaPagarMax.update({
        where: { id },
        data: { status: "cancelada" },
      });
      return NextResponse.json(updated);
    }

    // acao === "pagar"
    const now = new Date();
    const mes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const [transacao, updated] = await prisma.$transaction([
      prisma.transacao.create({
        data: {
          tipo: "despesa",
          valor: conta.valor,
          descricao: `Conta: ${conta.descricao}`,
          categoria: conta.categoria,
          tipo_negocio: conta.tipo_negocio,
          data_transacao: now,
          mes,
        },
      }),
      prisma.contaPagarMax.update({
        where: { id },
        data: { status: "paga", transacao_id: undefined },
      }),
    ]);

    // Update transacao_id after creation
    await prisma.contaPagarMax.update({
      where: { id },
      data: { transacao_id: transacao.id },
    });

    // If recorrente, create next occurrence
    if (conta.recorrente && conta.frequencia) {
      const nextDate = addFrequency(conta.data_vencimento, conta.frequencia);
      await prisma.contaPagarMax.create({
        data: {
          descricao: conta.descricao,
          valor: conta.valor,
          data_vencimento: nextDate,
          categoria: conta.categoria,
          tipo_negocio: conta.tipo_negocio,
          recorrente: true,
          frequencia: conta.frequencia,
        },
      });
    }

    return NextResponse.json({ ...updated, transacao_id: transacao.id });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/contas/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
