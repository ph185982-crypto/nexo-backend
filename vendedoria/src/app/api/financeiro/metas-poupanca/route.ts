import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listarMetasPoupanca, obterMetaPoupanca, registrarAporte, excluirAporte } from "@/lib/finance/metas-poupanca";
import { semearMetaPoupancaInicial } from "@/lib/finance/metas-poupanca-iniciais";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN") throw new Error("Forbidden");
}

function erro(err: unknown, onde: string) {
  if (err instanceof Error && err.message === "Forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  console.error(`[financeiro/metas-poupanca ${onde}]`, err);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

/** Metas de poupança ativas com progresso, projeção e últimos aportes. */
export async function GET() {
  try {
    await requireAdmin();
    await semearMetaPoupancaInicial().catch((e) => console.error("[metas-poupanca] meta inicial:", e));
    return NextResponse.json(await listarMetasPoupanca());
  } catch (err) {
    return erro(err, "GET");
  }
}

/** Registra um aporte (valor > 0) ou retirada (valor < 0): { meta_id, valor, data?, observacao? }. */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const valor = Number(body.valor);
    if (!body.meta_id || !Number.isFinite(valor) || valor === 0) {
      return NextResponse.json({ error: "Informe a meta e um valor diferente de zero." }, { status: 400 });
    }
    if (!(await obterMetaPoupanca(String(body.meta_id)))) return NextResponse.json({ error: "Meta não encontrada." }, { status: 404 });
    const data = typeof body.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.data) ? new Date(`${body.data}T00:00:00Z`) : undefined;
    await registrarAporte({ metaId: String(body.meta_id), valor, data, origem: "tela", observacao: body.observacao ?? null });
    return NextResponse.json(await obterMetaPoupanca(String(body.meta_id)));
  } catch (err) {
    return erro(err, "POST");
  }
}

/** Exclui um aporte lançado errado: ?aporte_id=… */
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    const id = req.nextUrl.searchParams.get("aporte_id");
    if (!id) return NextResponse.json({ error: "aporte_id obrigatório" }, { status: 400 });
    const r = await excluirAporte(id);
    if (!r) return NextResponse.json({ error: "Aporte não encontrado" }, { status: 404 });
    return NextResponse.json(r);
  } catch (err) {
    return erro(err, "DELETE");
  }
}
