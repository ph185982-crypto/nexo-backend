import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

// GET /api/prospeccao/orgs — lista orgs de prospecção ativas (para o dashboard)
export async function GET() {
  const orgs = await prisma.whatsappBusinessOrganization.findMany({
    where: { tipo: "PROSPECCAO", status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(orgs);
}
