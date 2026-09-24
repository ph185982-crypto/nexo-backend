// POST /api/prospeccao/fila/aprovar-score
// body: { orgId: string, scoreMin: number, segmentId?: string }
// Aprova de uma vez as empresas aguardando revisão com score >= scoreMin.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { exigirAcesso } from "@/lib/prospeccao/guard";

export async function POST(req: NextRequest) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const body = await req.json().catch(() => ({})) as { orgId?: string; scoreMin?: number; segmentId?: string };
  if (!body.orgId || typeof body.scoreMin !== "number") {
    return NextResponse.json({ error: "orgId e scoreMin são obrigatórios" }, { status: 400 });
  }
  const r = await prisma.prospectLead.updateMany({
    where: {
      organizationId: body.orgId,
      status: "ANALISADO",
      score: { gte: body.scoreMin },
      ...(body.segmentId ? { segmentId: body.segmentId } : {}),
    },
    data: { status: "APROVADO" },
  });
  return NextResponse.json({ ok: true, aprovados: r.count });
}
