import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

// GET /api/prospeccao/segmentos?orgId=...
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("orgId") ?? undefined;
  const segments = await prisma.prospectSegment.findMany({
    where: { ...(orgId ? { organizationId: orgId } : {}), ativo: true },
    include: { _count: { select: { prospects: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(segments);
}

// POST /api/prospeccao/segmentos — cria novo segmento
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    organizationId: string;
    nome: string;
    termoBusca: string;
    termosSecundarios?: string[];
    cidades?: string[];
    pesoSemSite?: number;
    pesoSemAnuncioAtivo?: number;
    pesoInstagramParado?: number;
    pesoRatingBaixo?: number;
    limiarScoreQualificado?: number;
  };

  if (!body.organizationId || !body.nome || !body.termoBusca) {
    return NextResponse.json({ error: "organizationId, nome e termoBusca são obrigatórios" }, { status: 400 });
  }

  const segment = await prisma.prospectSegment.create({
    data: {
      organizationId:        body.organizationId,
      nome:                  body.nome,
      termoBusca:            body.termoBusca,
      termosSecundarios:     body.termosSecundarios ?? [],
      cidades:               body.cidades           ?? ["Goiânia"],
      pesoSemSite:           body.pesoSemSite           ?? 3,
      pesoSemAnuncioAtivo:   body.pesoSemAnuncioAtivo   ?? 2,
      pesoInstagramParado:   body.pesoInstagramParado   ?? 1,
      pesoRatingBaixo:       body.pesoRatingBaixo       ?? 1,
      limiarScoreQualificado: body.limiarScoreQualificado ?? 4,
    },
  });

  return NextResponse.json(segment, { status: 201 });
}
