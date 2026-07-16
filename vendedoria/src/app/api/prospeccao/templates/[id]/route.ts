import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

// PATCH /api/prospeccao/templates/:id — atualiza/ativa template
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json() as {
    nomeTemplateMeta?: string;
    idioma?: string;
    variaveis?: string[];
    ativo?: boolean;
    corpoTexto?: string;
  };

  const existing = await prisma.templateProspeccao.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });
  }

  // Vários templates podem ficar ativos ao mesmo tempo — o disparo alterna
  // entre eles (rotação A/B) e o dashboard compara a taxa de resposta.
  const template = await prisma.templateProspeccao.update({
    where: { id },
    data: {
      ...(body.nomeTemplateMeta !== undefined ? { nomeTemplateMeta: body.nomeTemplateMeta.trim() } : {}),
      ...(body.idioma !== undefined ? { idioma: body.idioma } : {}),
      ...(body.variaveis !== undefined ? { variaveis: body.variaveis } : {}),
      ...(body.ativo !== undefined ? { ativo: body.ativo } : {}),
      ...(body.corpoTexto !== undefined ? { corpoTexto: body.corpoTexto } : {}),
    },
  });

  return NextResponse.json(template);
}

// DELETE /api/prospeccao/templates/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await prisma.templateProspeccao.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível excluir — o template é referenciado por leads já abordados." },
      { status: 409 },
    );
  }
}
