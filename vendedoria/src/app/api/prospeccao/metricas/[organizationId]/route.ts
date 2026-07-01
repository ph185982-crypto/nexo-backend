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

  const abordados = porStatus["ABORDADO"] ?? 0;
  const responderam = porStatus["RESPONDEU"] ?? 0;
  const qualificados = porStatus["QUALIFICADO"] ?? 0;
  const reunioes = porStatus["REUNIAO_AGENDADA"] ?? 0;

  const taxaResposta     = abordados > 0 ? responderam / abordados : 0;
  const taxaQualificacao = responderam > 0 ? qualificados / responderam : 0;
  const taxaReuniao      = qualificados > 0 ? reunioes / qualificados : 0;

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
    taxaResposta,
    taxaQualificacao,
    taxaReuniao,
    porSegmento,
  });
}
