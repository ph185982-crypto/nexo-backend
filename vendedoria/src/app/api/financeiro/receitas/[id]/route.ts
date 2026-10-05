// PATCH /api/financeiro/receitas/:id  — { acao, motivo? }
//   editar          → altera valor, descrição, data prevista, cliente ou observação (só receita em aberto)
//   confirmar       → marca como recebida e lança a entrada no extrato (Transacao)
//   perder          → dá PERDA na receita previsível (não vai mais entrar). Nada é apagado:
//                     fica com status "perdida", motivo e data — e dá para desfazer.
//   reverter_perda  → volta uma receita perdida para pendente

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseData } from "@/lib/finance/periodo";
import { getBrasiliaDateOnly, formatMesUTC } from "@/lib/max/config";

const ACOES = ["editar", "confirmar", "perder", "reverter_perda"] as const;
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

    if (acao === "editar") {
      if (!aberta) {
        return NextResponse.json(
          { error: `Só dá para editar receita em aberto (esta está "${receita.status}").` },
          { status: 409 },
        );
      }
      const data: Record<string, unknown> = {};
      if (body.valor !== undefined) {
        const v = Math.round(Number(body.valor) * 100) / 100;
        if (!Number.isFinite(v) || v <= 0) return NextResponse.json({ error: "Valor deve ser maior que zero." }, { status: 400 });
        data.valor = v;
      }
      if (typeof body.descricao === "string") {
        if (!body.descricao.trim()) return NextResponse.json({ error: "Descrição não pode ficar vazia." }, { status: 400 });
        data.descricao = body.descricao.trim().slice(0, 200);
      }
      if (body.cliente !== undefined) data.cliente = typeof body.cliente === "string" && body.cliente.trim() ? body.cliente.trim() : null;
      if (body.observacao !== undefined) data.observacao = typeof body.observacao === "string" && body.observacao.trim() ? body.observacao.trim() : null;
      if (body.data_prevista !== undefined) {
        const d = parseData(String(body.data_prevista));
        if (!d) return NextResponse.json({ error: "Data prevista inválida." }, { status: 400 });
        data.data_prevista = d;
        data.status = d < now ? "atrasada" : "pendente";
      }
      if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });
      return NextResponse.json(await prisma.receitaPrevistaMax.update({ where: { id }, data }));
    }

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
