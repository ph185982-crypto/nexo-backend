import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

// GET /api/prospeccao/metricas/:organizationId?segmentId=&dataInicio=&dataFim=
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;
  const { searchParams } = req.nextUrl;

  const segmentId = searchParams.get("segmentId") ?? undefined;
  const dataInicio = searchParams.get("dataInicio")
    ? new Date(searchParams.get("dataInicio")!)
    : undefined;
  const dataFim = searchParams.get("dataFim")
    ? new Date(searchParams.get("dataFim")!)
    : undefined;

  const filtroBase = {
    organizationId,
    ...(segmentId ? { segmentId } : {}),
    ...(dataInicio || dataFim
      ? { createdAt: { ...(dataInicio ? { gte: dataInicio } : {}), ...(dataFim ? { lte: dataFim } : {}) } }
      : {}),
  };

  // Contagem por status
  const porStatusRaw = await prisma.prospectLead.groupBy({
    by: ["status"],
    where: filtroBase,
    _count: { _all: true },
  });

  const porStatus: Record<string, number> = {};
  for (const row of porStatusRaw) {
    porStatus[row.status] = row._count._all;
  }

  // Funil CUMULATIVO: um lead em QUALIFICADO também conta como abordado e respondido.
  // Sem isso as taxas ficam distorcidas (o denominador esvazia conforme o lead avança).
  const s = (k: string) => porStatus[k] ?? 0;
  const reunioes     = s("REUNIAO_AGENDADA");
  const qualificados = s("QUALIFICADO") + reunioes;
  const responderam  = s("RESPONDEU") + qualificados;
  const abordados    = await prisma.prospectLead.count({
    where: { ...filtroBase, dataAbordagem: { not: null } },
  });

  const taxaResposta     = abordados > 0 ? responderam / abordados : 0;
  const taxaQualificacao = responderam > 0 ? qualificados / responderam : 0;
  const taxaReuniao      = qualificados > 0 ? reunioes / qualificados : 0;

  // Quebra por template (base para A/B): respostas e reuniões por template usado
  const templates = await prisma.templateProspeccao.findMany({
    where: { organizationId },
    select: { id: true, nomeTemplateMeta: true, ativo: true },
  });
  const porTemplate = await Promise.all(
    templates.map(async (t) => {
      const filtroTpl = { ...filtroBase, templateUsadoId: t.id };
      const [enviados, respondidos, reunioesTpl] = await Promise.all([
        prisma.prospectLead.count({ where: { ...filtroTpl, dataAbordagem: { not: null } } }),
        prisma.prospectLead.count({ where: { ...filtroTpl, status: { in: ["RESPONDEU", "QUALIFICADO", "REUNIAO_AGENDADA"] } } }),
        prisma.prospectLead.count({ where: { ...filtroTpl, status: "REUNIAO_AGENDADA" } }),
      ]);
      return {
        templateId: t.id,
        nome: t.nomeTemplateMeta,
        ativo: t.ativo,
        enviados,
        respondidos,
        reunioes: reunioesTpl,
        taxaResposta: enviados > 0 ? respondidos / enviados : 0,
      };
    }),
  );

  // Envios por dia (últimos 14 dias) — evolução do volume
  const inicio14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const abordagens = await prisma.prospectLead.findMany({
    where: { ...filtroBase, dataAbordagem: { gte: inicio14d } },
    select: { dataAbordagem: true },
  });
  const enviosPorDia: Record<string, number> = {};
  for (const a of abordagens) {
    if (!a.dataAbordagem) continue;
    const dia = a.dataAbordagem.toISOString().slice(0, 10);
    enviosPorDia[dia] = (enviosPorDia[dia] ?? 0) + 1;
  }

  // Por segmento
  const segmentos = await prisma.prospectSegment.findMany({
    where: { organizationId, ativo: true },
    select: { id: true, nome: true },
  });

  const porSegmento = await Promise.all(
    segmentos.map(async (seg) => {
      const filtroSeg = {
        ...filtroBase,
        segmentId: seg.id,
      };

      const total = await prisma.prospectLead.count({ where: filtroSeg });
      const abordadosSeg = await prisma.prospectLead.count({
        where: { ...filtroSeg, status: { in: ["ABORDADO", "RESPONDEU", "QUALIFICADO", "REUNIAO_AGENDADA", "PERDIDO"] } },
      });
      const reunioesSeg = await prisma.prospectLead.count({
        where: { ...filtroSeg, status: "REUNIAO_AGENDADA" },
      });

      return {
        segmentId: seg.id,
        nome: seg.nome,
        leads: total,
        abordados: abordadosSeg,
        reunioes: reunioesSeg,
        taxaConversaoTotal: abordadosSeg > 0 ? reunioesSeg / abordadosSeg : 0,
      };
    }),
  );

  return NextResponse.json({
    porStatus,
    funil: { abordados, responderam, qualificados, reunioes },
    taxaResposta,
    taxaQualificacao,
    taxaReuniao,
    porSegmento,
    porTemplate,
    enviosPorDia,
  });
}
