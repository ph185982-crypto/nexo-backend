import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listarLigacoes } from "@/lib/crm/ligacoes";
import { acionarFollowupsSePreciso } from "@/lib/followup/gatilho";
import { acionarRecuperacaoSePreciso, recuperarFalhasSdr } from "@/lib/ai/sdr/recuperar-falhas";
import { acionarAvisoContasSePreciso } from "@/lib/max/crons/contas-vespera";

export async function GET(req: NextRequest) {
  acionarFollowupsSePreciso("crm").catch(() => {});
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  const organizationId = req.nextUrl.searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId obrigatório" }, { status: 400 });
  // Abrir a tela já traz quem ficou sem resposta da IA (só cria avisos aqui —
  // nova tentativa da IA roda em segundo plano, para a tela não esperar o LLM).
  await recuperarFalhasSdr({ maxReprocessar: 0 }).catch((e) => console.error("[Ligações] recuperação:", e));
  acionarRecuperacaoSePreciso("crm");
  acionarAvisoContasSePreciso("crm");
  return NextResponse.json(await listarLigacoes(organizationId));
}
