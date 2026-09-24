// PATCH  /api/prospeccao/segmentos/:id — edita a busca (termos, cidades, filtros, pesos)
// DELETE /api/prospeccao/segmentos/:id — arquiva a busca (ativo=false; as empresas ficam)

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import { exigirAcesso } from "@/lib/prospeccao/guard";

const PESOS = ["pesoSemSite", "pesoSemAnuncioAtivo", "pesoInstagramParado", "pesoRatingBaixo", "limiarScoreQualificado"] as const;

function limparLista(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return Array.from(new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const data: Prisma.ProspectSegmentUpdateInput = {};
  if (typeof body.nome === "string" && body.nome.trim()) data.nome = body.nome.trim();
  if (typeof body.termoBusca === "string" && body.termoBusca.trim()) data.termoBusca = body.termoBusca.trim();
  const secundarios = limparLista(body.termosSecundarios);
  if (secundarios) data.termosSecundarios = secundarios;
  const cidades = limparLista(body.cidades);
  if (cidades) {
    if (cidades.length === 0) return NextResponse.json({ error: "Informe ao menos uma cidade" }, { status: 400 });
    data.cidades = cidades;
  }
  if (typeof body.apenasCelular === "boolean") data.apenasCelular = body.apenasCelular;
  if (typeof body.filtroSite === "string" && ["TODOS", "COM_SITE", "SEM_SITE"].includes(body.filtroSite)) data.filtroSite = body.filtroSite;
  if (typeof body.metaEmpresas === "number") data.metaEmpresas = Math.min(Math.max(Math.round(body.metaEmpresas), 20), 5000);
  for (const p of PESOS) {
    const v = body[p];
    if (typeof v === "number" && Number.isFinite(v)) data[p] = Math.min(Math.max(Math.round(v), 0), 20);
  }
  if (typeof body.ativo === "boolean") data.ativo = body.ativo;

  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });

  try {
    const segment = await prisma.prospectSegment.update({ where: { id }, data });
    return NextResponse.json(segment);
  } catch {
    return NextResponse.json({ error: "Busca não encontrada" }, { status: 404 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { id } = await params;
  try {
    await prisma.prospectSegment.update({ where: { id }, data: { ativo: false } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Busca não encontrada" }, { status: 404 });
  }
}
