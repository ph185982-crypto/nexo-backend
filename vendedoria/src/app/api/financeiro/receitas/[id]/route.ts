// PATCH /api/financeiro/receitas/:id  — { acao, motivo? }
//   confirmar       → marca como recebida e lança a entrada no extrato (Transacao)
//   perder          → dá PERDA na receita previsível (não vai mais entrar). Nada é apagado:
//                     fica com status "perdida", motivo e data — e dá para desfazer.
//   reverter_perda  → volta uma receita perdida para pendente

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getBrasiliaDateOnly, formatMesUTC } from "@/lib/max/config";

const ACOES = ["confirmar", "perder", "reverter_perda"] as const;
type Acao = (typeof ACOES)[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const acao = body.acao as Acao;

    if (!ACOES.includes(acao)) {
      return NextResponse.json({ error: `acao deve ser uma de: ${ACOES.join(", ")}` }, { status: 400 });
    }

    const receita = await prisma.receitaPrevistaMax.findUnique({ where: { id } });
    if (!receita) return NextResponse.json({ error: "Receita não encontrada" }, { status: 404 });

    const aberta = receita.status === "pendente" || receita.status === "atrasada";
    const now = getBrasiliaDateOnly();

    if (acao === "perder") {
      if (!aberta) {
        return NextResponse.json(
          { error: `Só dá para dar perda em receita em aberto (esta está "${receita.status}").` },
          { status: 409 },
        );
      }
      const motivo = typeof body.motivo === "string" ? body.motivo.trim().slice(0, 300) : "";
      const updated = await prisma.receitaPrevistaMax.update({
        where: { id },
        data: { status: "perdida", data_perda: now, motivo_perda: motivo || null },
      });
      return NextResponse.json(updated);
    }

    if (acao === "reverter_perda") {
      if (receita.status !== "perdida") {
        return NextResponse.json({ error: "Esta receita não está marcada como perdida." }, { status: 409 });
      }
      const updated = await prisma.receitaPrevistaMax.update({
        where: { id },
        data: { status: "pendente", data_perda: null, motivo_perda: null },
      });
      return NextResponse.json(updated);
    }

    // confirmar
    if (receita.status === "recebida") {
      return NextResponse.json({ error: "Esta receita já foi recebida." }, { status: 409 });
    }
    if (receita.status === "perdida") {
      return NextResponse.json(
        { error: "Esta receita está marcada como perdida — desfaça a perda antes de confirmar o recebimento." },
        { status: 409 },
      );
    }

    const [updated] = await prisma.$transaction([
      prisma.receitaPrevistaMax.update({
        where: { id },
        data: { status: "recebida", data_recebimento: now },
      }),
      prisma.transacao.create({
        data: {
          tipo: "receita",
          valor: receita.valor,
          descricao: `Receita: ${receita.descricao}`,
          categoria: "Receita Prevista",
          tipo_negocio: receita.tipo_negocio ?? "pessoal",
          data_transacao: now,
          mes: formatMesUTC(now),
        },
      }),
    ]);

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[financeiro/receitas/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
