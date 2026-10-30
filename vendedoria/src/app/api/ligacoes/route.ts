import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listarLigacoes } from "@/lib/crm/ligacoes";
import { acionarFollowupsSePreciso } from "@/lib/followup/gatilho";

export async function GET(req: NextRequest) {
  acionarFollowupsSePreciso("crm").catch(() => {});
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  const organizationId = req.nextUrl.searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId obrigatório" }, { status: 400 });
  return NextResponse.json(await listarLigacoes(organizationId));
}
