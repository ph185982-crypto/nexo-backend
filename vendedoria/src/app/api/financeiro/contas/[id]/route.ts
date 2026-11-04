import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";
import { getBrasiliaDateOnly, formatMesUTC } from "@/lib/max/config";

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

    if (!acao || !["pagar", "cancelar", "editar"].includes(acao)) {
      return NextResponse.json({ error: "acao must be 'pagar', 'cancelar' or 'editar'" }, { status: 400 });
    }

    const conta = await prisma.contaPagarMax.findUnique({ where: { id } });
    if (!conta) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (acao === "editar") {
      // Conta já paga virou lançamento no extrato; mexer no valor aqui deixaria
      // os dois diferentes. Só a conta em aberto pode ser editada.
      if (conta.status !== "pendente") {
        return NextResponse.json({ error: "Só é possível editar uma conta pendente." }, { status: 409 });
      }
      const data: Record<string, unknown> = {};
      if (body.descricao !== undefined) {
        const d = String(body.descricao).trim();
        if (!d) return NextResponse.json({ error: "Informe a descrição." }, { status: 400 });
        data.descricao = d;
      }
      if (body.valor !== undefined) {
        const v = Number(body.valor);
        if (!Number.isFinite(v) || v <= 0) return NextResponse.json({ error: "Informe um valor maior que zero." }, { status: 400 });
        data.valor = Math.round(v * 100) / 100;
      }
      if (body.data_vencimento !== undefined) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(body.data_vencimento));
        const dt = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
        if (!dt || isNaN(dt.getTime())) return NextResponse.json({ error: "Data de vencimento inválida." }, { status: 400 });
        data.data_vencimento = dt;
      }
      if (body.categoria !== undefined) data.categoria = String(body.categoria).trim() || "Outros";
      if (body.tipo_negocio !== undefined) {
        const t = String(body.tipo_negocio);
        if (!["pessoal", "nexo", "lukaizen", "geral"].includes(t)) return NextResponse.json({ error: "Negócio inválido." }, { status: 400 });
        data.tipo_negocio = t;
      }
      if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });
      // O livro-razão (historico.ts) grava o antes e o depois desta alteração.
      return NextResponse.json(await prisma.contaPagarMax.update({ where: { id }, data }));
    }

    if (acao === "cancelar") {
      const updated = await prisma.contaPagarMax.update({
        where: { id },
        data: { status: "cancelada" },
      });
      return NextResponse.json(updated);
    }

    // acao === "pagar"
    const now = getBrasiliaDateOnly();
    const mes = formatMesUTC(now);

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

// DELETE /api/financeiro/contas/:id — exclui a conta a pagar. O livro-razão grava
// uma cópia completa ANTES de apagar (se não conseguir gravar, a exclusão é
// cancelada), então dá para restaurar pelo Histórico. Uma conta já paga não leva
// o lançamento do extrato junto: ele continua lá.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const conta = await prisma.contaPagarMax.findUnique({ where: { id }, select: { id: true } });
    if (!conta) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.contaPagarMax.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/contas/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
