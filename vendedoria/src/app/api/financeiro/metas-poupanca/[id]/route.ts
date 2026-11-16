import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma/client";
import { obterMetaPoupanca } from "@/lib/finance/metas-poupanca";

/** Ajusta a meta: { aporte_diario?, valor_alvo?, data_fim?, cobrar_diariamente?, chave_pix?, descricao?, status? }. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id } = await params;
    if (!(await obterMetaPoupanca(id))) return NextResponse.json({ error: "Meta não encontrada." }, { status: 404 });
    const b = await req.json();
    const data: Record<string, unknown> = {};
    if (b.aporte_diario !== undefined) {
      const v = Number(b.aporte_diario);
      if (!(v >= 0)) return NextResponse.json({ error: "Valor diário inválido." }, { status: 400 });
      data.aporte_diario = v;
    }
    if (b.valor_alvo !== undefined) {
      const v = Number(b.valor_alvo);
      if (!(v > 0)) return NextResponse.json({ error: "Valor da meta inválido." }, { status: 400 });
      data.valor_alvo = v;
    }
    if (b.data_fim !== undefined) {
      if (typeof b.data_fim !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.data_fim)) return NextResponse.json({ error: "Prazo inválido." }, { status: 400 });
      data.data_fim = new Date(`${b.data_fim}T00:00:00Z`);
    }
    if (typeof b.cobrar_diariamente === "boolean") data.cobrar_diariamente = b.cobrar_diariamente;
    if (typeof b.chave_pix === "string") data.chave_pix = b.chave_pix.trim() || null;
    if (typeof b.descricao === "string" && b.descricao.trim()) data.descricao = b.descricao.trim();
    if (b.status === "ativa" || b.status === "encerrada") data.status = b.status;
    await prisma.metaFinanceiraMax.update({ where: { id }, data });
    return NextResponse.json(await obterMetaPoupanca(id));
  } catch (err) {
    console.error("[financeiro/metas-poupanca PATCH]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
