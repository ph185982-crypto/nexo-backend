import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

// GET /api/prospeccao/fila?status=ANALISADO&orgId=...
// Retorna leads aguardando revisão humana (ou aprovados para spot-check)
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const status       = searchParams.get("status") ?? "ANALISADO";
  const orgId        = searchParams.get("orgId")  ?? undefined;
  const tipoTelefone = searchParams.get("tipoTelefone") ?? undefined; // FIXO | CELULAR
  const page     = parseInt(searchParams.get("page") ?? "1", 10);
  const pageSize = 30;

  const where = {
    status,
    ...(orgId ? { organizationId: orgId } : {}),
    ...(tipoTelefone ? { tipoTelefone } : {}),
  };

  const [leads, total] = await Promise.all([
    prisma.prospectLead.findMany({
      where,
      include: { segment: { select: { nome: true, termoBusca: true } } },
      orderBy: { score: "desc" },
      skip:  (page - 1) * pageSize,
      take:  pageSize,
    }),
    prisma.prospectLead.count({ where }),
  ]);

  return NextResponse.json({ leads, total, page, pageSize });
}
