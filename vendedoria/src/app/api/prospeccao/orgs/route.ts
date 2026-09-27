import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { exigirAcesso } from "@/lib/prospeccao/guard";

// GET /api/prospeccao/orgs — lista orgs de prospecção ativas (para o dashboard)
export async function GET(req: NextRequest) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const orgs = await prisma.whatsappBusinessOrganization.findMany({
    where: { tipo: "PROSPECCAO", status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(orgs);
}
