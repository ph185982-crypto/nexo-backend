import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

// GET /api/prospeccao/templates?orgId=...
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("orgId") ?? undefined;
  const templates = await prisma.templateProspeccao.findMany({
    where: { ...(orgId ? { organizationId: orgId } : {}) },
    include: { _count: { select: { prospects: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(templates);
}

// POST /api/prospeccao/templates — cadastra template HSM aprovado na Meta
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    organizationId: string;
    nomeTemplateMeta: string;
    idioma?: string;
    variaveis?: string[];
    ativo?: boolean;
  };

  if (!body.organizationId || !body.nomeTemplateMeta) {
    return NextResponse.json(
      { error: "organizationId e nomeTemplateMeta são obrigatórios" },
      { status: 400 },
    );
  }

  // Só um template ativo por vez — desativa os demais se este nasce ativo
  const ativo = body.ativo ?? true;
  if (ativo) {
    await prisma.templateProspeccao.updateMany({
      where: { organizationId: body.organizationId, ativo: true },
      data: { ativo: false },
    });
  }

  const template = await prisma.templateProspeccao.create({
    data: {
      organizationId:   body.organizationId,
      nomeTemplateMeta: body.nomeTemplateMeta.trim(),
      idioma:           body.idioma ?? "pt_BR",
      variaveis:        body.variaveis ?? [],
      ativo,
    },
  });

  return NextResponse.json(template, { status: 201 });
}
