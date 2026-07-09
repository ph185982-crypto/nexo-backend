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

    const diasParam = parseInt(
      new URL(req.url).searchParams.get("dias") ?? "30",
      10
    );
    const dias = Math.min(60, Math.max(1, diasParam));

    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
    );
    const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Current month saldo
    const [recAgg, despAgg] = await Promise.all([
      prisma.transacao.aggregate({
        where: { mes: mesAtual, tipo: "receita" },
        _sum: { valor: true },
      }),
      prisma.transacao.aggregate({
        where: { mes: mesAtual, tipo: "despesa" },
        _sum: { valor: true },
      }),
    ]);
    const saldo_atual = (recAgg._sum.valor ?? 0) - (despAgg._sum.valor ?? 0);

    // Burn rate: average daily spending over last 60 days
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const burnAgg = await prisma.transacao.aggregate({
      where: {
        tipo: "despesa",
        data_transacao: { gte: sixtyDaysAgo },
      },
      _sum: { valor: true },
    });
    const burn_rate = Math.round(((burnAgg._sum.valor ?? 0) / 60) * 100) / 100;

    // Upcoming receitas previstas (pendentes)
    const hoje = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fimProjecao = new Date(hoje);
    fimProjecao.setDate(fimProjecao.getDate() + dias);

    const [receitasFuturas, contasFuturas] = await Promise.all([
      prisma.receitaPrevistaMax.findMany({
        where: {
          status: "pendente",
          data_prevista: { gte: hoje, lte: fimProjecao },
        },
      }),
      prisma.contaPagarMax.findMany({
        where: {
          status: "pendente",
          data_vencimento: { gte: hoje, lte: fimProjecao },
        },
      }),
    ]);

    // Build day-by-day projection
    const receitasByDate = new Map<string, typeof receitasFuturas>();
    for (const r of receitasFuturas) {
      const key = r.data_prevista.toISOString().slice(0, 10);
      if (!receitasByDate.has(key)) receitasByDate.set(key, []);
      receitasByDate.get(key)!.push(r);
    }

    const contasByDate = new Map<string, typeof contasFuturas>();
    for (const c of contasFuturas) {
      const key = c.data_vencimento.toISOString().slice(0, 10);
      if (!contasByDate.has(key)) contasByDate.set(key, []);
      contasByDate.get(key)!.push(c);
    }

    let saldo = saldo_atual;
    let primeiro_negativo: string | null = null;
    const diasArray: Array<{
      data: string;
      saldo: number;
      eventos: string[];
    }> = [];

    for (let i = 0; i < dias; i++) {
      const dia = new Date(hoje);
      dia.setDate(dia.getDate() + i);
      const dataStr = dia.toISOString().slice(0, 10);
      const eventos: string[] = [];

      // Subtract daily burn
      saldo -= burn_rate;

      // Add receitas
      const receitasDia = receitasByDate.get(dataStr) ?? [];
      for (const r of receitasDia) {
        saldo += r.valor;
        eventos.push(`Receita: ${r.descricao} R$${r.valor.toFixed(2)}`);
      }

      // Subtract contas
      const contasDia = contasByDate.get(dataStr) ?? [];
      for (const c of contasDia) {
        saldo -= c.valor;
        eventos.push(`Conta: ${c.descricao} R$${c.valor.toFixed(2)}`);
      }

      saldo = Math.round(saldo * 100) / 100;

      if (saldo < 0 && !primeiro_negativo) {
        primeiro_negativo = dataStr;
      }

      diasArray.push({ data: dataStr, saldo, eventos });
    }

    return NextResponse.json({
      saldo_atual,
      burn_rate,
      primeiro_negativo,
      dias: diasArray,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/projecao GET]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
