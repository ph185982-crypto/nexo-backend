import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { aplicarSincronizacao, previaSincronizacao, type EscopoSincronizacao } from "@/lib/crm/sincronizar-kanban";

// GET  ?organizationId=...            → prévia (quantos cards cada correção moveria)
// POST { organizationId, escopo }      → aplica uma correção ("escalados" | "outbound")
// Só ADMIN. Nada é apagado — cards mudam de coluna com registro na atividade do lead.

const ESCOPOS: EscopoSincronizacao[] = ["escalados", "outbound"];

export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  const organizationId = req.nextUrl.searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId obrigatório" }, { status: 400 });
  const previas = await Promise.all(ESCOPOS.map((e) => previaSincronizacao(organizationId, e)));
  return NextResponse.json({ previas });
}

export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  const body = await req.json().catch(() => ({})) as { organizationId?: string; escopo?: string };
  if (!body.organizationId || !ESCOPOS.includes(body.escopo as EscopoSincronizacao)) {
    return NextResponse.json({ error: "organizationId e escopo (escalados|outbound) obrigatórios" }, { status: 400 });
  }
  const resultado = await aplicarSincronizacao(body.organizationId, body.escopo as EscopoSincronizacao);
  return NextResponse.json(resultado);
}
