import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

// GET /api/prospeccao/leads/:segmentId?page=1&status=
// Lista todos os leads de um segmento, com paginação
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const { segmentId } = await params;
  const { searchParams } = req.nextUrl;
  const status   = searchParams.get("status") ?? undefined;
  const page     = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = 50;

  const where = {
    segmentId,
    ...(status ? { status } : {}),
  };

  const [leads, total, segment] = await Promise.all([
    prisma.prospectLead.findMany({
      where,
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      skip:    (page - 1) * pageSize,
      take:    pageSize,
      select:  {
        id: true, nome: true, telefone: true, tipoTelefone: true,
        enderecoCompleto: true, website: true, status: true, score: true,
        ratingGoogle: true, numeroAvaliacoes: true,
        analiseIA: true, createdAt: true,
      },
    }),
    prisma.prospectLead.count({ where }),
    prisma.prospectSegment.findUnique({
      where: { id: segmentId },
      select: { id: true, nome: true, termoBusca: true, cidades: true, organizationId: true },
    }),
  ]);

  return NextResponse.json({ segment, leads, total, page, pageSize });
}
