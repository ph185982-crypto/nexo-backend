import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page  = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(50, parseInt(searchParams.get("limit") ?? "20", 10));
  const status = searchParams.get("status"); // PRONTA | ENVIADA | FALHA

  const where = status ? { status } : {};

  const [total, ofertas] = await Promise.all([
    prisma.ofertaGerada.count({ where }),
    prisma.ofertaGerada.findMany({
      where,
      orderBy: { criadaEm: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        produto: {
          select: { id: true, nome: true, fotoUrl: true, ativo: true },
        },
      },
    }),
  ]);

  return NextResponse.json({ total, page, limit, ofertas });
}
