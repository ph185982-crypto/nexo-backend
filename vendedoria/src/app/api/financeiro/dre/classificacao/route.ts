// GET /api/financeiro/dre/classificacao → grupos da DRE + todas as categorias
//     já usadas com o grupo atual de cada uma (padrão ou manual).
// PUT /api/financeiro/dre/classificacao
//     { tipo, categoria, grupo }  → fixa a linha de uma categoria inteira
//     { lancamentoId, grupo }     → move só aquele lançamento do extrato
//     grupo = chave de GRUPOS_DRE, ou null para voltar à regra automática.
//     Nenhum lançamento muda — só a linha da DRE em que ele aparece. Fica
//     registrado no histórico financeiro.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { GRUPOS_DRE, ehGrupoDre } from "@/lib/finance/dre";
import { definirClassificacao, definirClassificacaoLancamento, listarClassificacoes } from "@/lib/finance/dre-dados";

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

const ERROS_DO_USUARIO = ["O grupo", "Categoria vazia", "Lançamento não encontrado", "Lançamento sem tipo"];

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = (await req.json().catch(() => null)) as
      | { tipo?: unknown; categoria?: unknown; grupo?: unknown; lancamentoId?: unknown }
      | null;
    const grupo = body?.grupo ?? null;
    if (grupo !== null && !ehGrupoDre(grupo)) {
      return NextResponse.json({ error: "Grupo inválido" }, { status: 400 });
    }

    if (typeof body?.lancamentoId === "string" && body.lancamentoId.trim()) {
      await definirClassificacaoLancamento(body.lancamentoId.trim(), grupo);
      return NextResponse.json({ ok: true });
    }

    const tipo = body?.tipo;
    const categoria = typeof body?.categoria === "string" ? body.categoria.trim() : "";
    if ((tipo !== "receita" && tipo !== "despesa") || !categoria) {
      return NextResponse.json({ error: "Informe lancamentoId, ou tipo (receita|despesa) e categoria" }, { status: 400 });
    }
    await definirClassificacao(tipo, categoria, grupo);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (ERROS_DO_USUARIO.some((e) => msg.startsWith(e))) return NextResponse.json({ error: msg }, { status: 400 });
    console.error("[financeiro/dre/classificacao PUT]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
