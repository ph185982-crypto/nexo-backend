// GET /api/prospeccao/empresas — lista filtrada de empresas prospectadas.
// Query: orgId (obrigatório), segmentId, etapa, status, tipoTelefone (CELULAR|FIXO),
//        scoreMin, site (com|sem), q (nome/telefone/endereço), ordem, page, pageSize

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import { exigirAcesso } from "@/lib/prospeccao/guard";
import { isStatus, statusDaEtapa, type EtapaId } from "@/lib/prospeccao/status";

const ORDENS: Record<string, Prisma.ProspectLeadOrderByWithRelationInput[]> = {
  score:    [{ score: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  recentes: [{ createdAt: "desc" }],
  nome:     [{ nome: "asc" }],
  avaliacao: [{ ratingGoogle: { sort: "desc", nulls: "last" } }],
  atualizados: [{ updatedAt: "desc" }],
};

export async function GET(req: NextRequest) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;

  const sp = req.nextUrl.searchParams;
  const orgId = sp.get("orgId");
  if (!orgId) return NextResponse.json({ error: "orgId obrigatório" }, { status: 400 });

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(10, parseInt(sp.get("pageSize") ?? "50", 10) || 50));

  const where: Prisma.ProspectLeadWhereInput = { organizationId: orgId };
  const and: Prisma.ProspectLeadWhereInput[] = [];

  const segmentId = sp.get("segmentId");
  if (segmentId) where.segmentId = segmentId;

  const status = sp.get("status");
  const etapa = sp.get("etapa") as EtapaId | null;
  if (status && isStatus(status)) where.status = status;
  else if (etapa) where.status = { in: statusDaEtapa(etapa) };

  const tipoTelefone = sp.get("tipoTelefone");
  if (tipoTelefone === "CELULAR" || tipoTelefone === "FIXO") where.tipoTelefone = tipoTelefone;

  const scoreMin = sp.get("scoreMin");
  if (scoreMin && !Number.isNaN(Number(scoreMin))) where.score = { gte: Number(scoreMin) };

  const site = sp.get("site");
  if (site === "com") and.push({ website: { not: null } });
  if (site === "sem") and.push({ website: null });

  const q = sp.get("q")?.trim();
  if (q) {
    const digitos = q.replace(/\D/g, "");
    and.push({
      OR: [
        { nome: { contains: q, mode: "insensitive" } },
        { enderecoCompleto: { contains: q, mode: "insensitive" } },
        ...(digitos.length >= 4 ? [{ telefone: { contains: digitos } }] : []),
      ],
    });
  }
  if (and.length) where.AND = and;

  const orderBy = ORDENS[sp.get("ordem") ?? "score"] ?? ORDENS.score;

  const [empresas, total] = await Promise.all([
    prisma.prospectLead.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, nome: true, telefone: true, tipoTelefone: true, enderecoCompleto: true,
        website: true, status: true, score: true, ratingGoogle: true, numeroAvaliacoes: true,
        temSite: true, temAnuncioAtivo: true, instagramAtivo: true, followersIG: true,
        analiseIA: true, motivoAnaliseIA: true, dataAbordagem: true, tentativasDisparo: true,
        createdAt: true, updatedAt: true,
        segment: { select: { id: true, nome: true } },
      },
    }),
    prisma.prospectLead.count({ where }),
  ]);

  return NextResponse.json({ empresas, total, page, pageSize });
}
