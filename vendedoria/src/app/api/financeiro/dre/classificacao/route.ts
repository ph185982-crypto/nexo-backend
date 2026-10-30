// GET /api/financeiro/dre/classificacao → grupos da DRE + todas as categorias
//     já usadas com o grupo atual de cada uma (padrão ou manual).
// PUT /api/financeiro/dre/classificacao { tipo, categoria, grupo }
//     grupo = chave de GRUPOS_DRE para fixar à mão, ou null para voltar ao
//     padrão. Nenhum lançamento muda — só a linha da DRE em que a categoria
//     aparece. Fica registrado no histórico financeiro.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { GRUPOS_DRE, ehGrupoDre } from "@/lib/finance/dre";
import { definirClassificacao, listarClassificacoes } from "@/lib/finance/dre-dados";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json({ grupos: GRUPOS_DRE, itens: await listarClassificacoes() });
  } catch (err) {
    console.error("[financeiro/dre/classificacao GET]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = (await req.json().catch(() => null)) as { tipo?: unknown; categoria?: unknown; grupo?: unknown } | null;
    const tipo = body?.tipo;
    const categoria = typeof body?.categoria === "string" ? body.categoria.trim() : "";
    const grupo = body?.grupo ?? null;
    if ((tipo !== "receita" && tipo !== "despesa") || !categoria) {
      return NextResponse.json({ error: "Informe tipo (receita|despesa) e categoria" }, { status: 400 });
    }
    if (grupo !== null && !ehGrupoDre(grupo)) {
      return NextResponse.json({ error: "Grupo inválido" }, { status: 400 });
    }
    await definirClassificacao(tipo, categoria, grupo);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.startsWith("O grupo") || msg === "Categoria vazia") return NextResponse.json({ error: msg }, { status: 400 });
    console.error("[financeiro/dre/classificacao PUT]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
