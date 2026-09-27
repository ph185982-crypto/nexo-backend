// GET   /api/prospeccao/empresas/:id — detalhe completo da empresa prospectada
// PATCH /api/prospeccao/empresas/:id — { notas?, acao? } (acao: ver ACOES_MANUAIS)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { exigirAcesso } from "@/lib/prospeccao/guard";
import { explicarScore } from "@/lib/prospeccao/score";
import { ACOES_MANUAIS, isAcaoManual } from "@/lib/prospeccao/status";
import { dadosDaAcao } from "@/lib/prospeccao/acoes";

const PESOS_PADRAO = { pesoSemSite: 3, pesoSemAnuncioAtivo: 2, pesoInstagramParado: 1, pesoRatingBaixo: 1 };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { id } = await params;

  const empresa = await prisma.prospectLead.findUnique({
    where: { id },
    include: {
      segment: {
        select: {
          id: true, nome: true, termoBusca: true, limiarScoreQualificado: true,
          pesoSemSite: true, pesoSemAnuncioAtivo: true, pesoInstagramParado: true, pesoRatingBaixo: true,
        },
      },
      templateUsado: { select: { id: true, nomeTemplateMeta: true } },
      leads: {
        select: {
          id: true,
          conversations: {
            select: { id: true, lastMessageAt: true, humanTakeover: true },
            orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
            take: 1,
          },
        },
        take: 1,
      },
    },
  });
  if (!empresa) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });

  const pesos = empresa.segment ?? PESOS_PADRAO;
  const conversa = empresa.leads[0]?.conversations[0] ?? null;

  return NextResponse.json({
    ...empresa,
    leads: undefined,
    leadId: empresa.leads[0]?.id ?? null,
    conversa,
    scoreDetalhe: explicarScore(empresa, pesos),
    limiar: empresa.segment?.limiarScoreQualificado ?? 4,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { notas?: string; acao?: string };

  const atual = await prisma.prospectLead.findUnique({ where: { id }, select: { status: true } });
  if (!atual) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (typeof body.notas === "string") data.notas = body.notas.slice(0, 5000);

  if (body.acao) {
    if (!isAcaoManual(body.acao)) {
      return NextResponse.json({ error: `Ação inválida: ${body.acao}` }, { status: 400 });
    }
    const regra = ACOES_MANUAIS[body.acao];
    if (!(regra.de as readonly string[]).includes(atual.status)) {
      return NextResponse.json(
        { error: `Não é possível "${body.acao}" uma empresa com status ${atual.status}` },
        { status: 409 },
      );
    }
    Object.assign(data, dadosDaAcao(body.acao));
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const empresa = await prisma.prospectLead.update({ where: { id }, data, select: { id: true, status: true, notas: true } });
  return NextResponse.json({ ok: true, empresa });
}
