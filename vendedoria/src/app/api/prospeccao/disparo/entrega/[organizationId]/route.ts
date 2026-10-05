// GET /api/prospeccao/disparo/entrega/:organizationId?dias=7
// Taxa de entrega dos templates de prospecção, vinda dos webhooks de status da Meta.
// Somente leitura.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { exigirAcesso } from "@/lib/prospeccao/guard";
import { explicarErroMeta } from "@/lib/prospeccao/entrega";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { organizationId } = await params;
  const dias = Math.min(Math.max(Number(new URL(req.url).searchParams.get("dias")) || 7, 1), 90);
  const desde = new Date(Date.now() - dias * 86_400_000);
  const base = { organizationId, enviadoEm: { gte: desde } };

  const [porStatus, erros, porTemplate, semRastreio, ultimaAtualizacao] = await Promise.all([
    prisma.disparoEnvio.groupBy({ by: ["status"], where: base, _count: true }),
    prisma.disparoEnvio.groupBy({
      by: ["erroCodigo"], where: { ...base, status: "FAILED" }, _count: true,
      orderBy: { _count: { erroCodigo: "desc" } },
    }),
    prisma.disparoEnvio.groupBy({ by: ["templateId", "status"], where: base, _count: true }),
    prisma.disparoEnvio.count({ where: { ...base, wamid: null } }),
    prisma.disparoEnvio.findFirst({
      where: { organizationId, OR: [{ entregueEm: { not: null } }, { falhouEm: { not: null } }] },
      orderBy: { enviadoEm: "desc" }, select: { entregueEm: true, falhouEm: true },
    }),
  ]);

  const n = (st: string) => porStatus.find((p) => p.status === st)?._count ?? 0;
  const lidos = n("READ");
  const entregues = n("DELIVERED") + lidos; // lido implica entregue
  const falhas = n("FAILED");
  const parados = n("SENT"); // enviado à Meta, sem confirmação de entrega
  const total = lidos + n("DELIVERED") + falhas + parados;

  const templates = await prisma.templateProspeccao.findMany({
    where: { organizationId }, select: { id: true, nomeTemplateMeta: true },
  });

  return NextResponse.json({
    dias, total, entregues, lidos, falhas, semConfirmacao: parados,
    taxaEntrega: total ? Math.round((entregues / total) * 1000) / 10 : null,
    taxaLeitura: total ? Math.round((lidos / total) * 1000) / 10 : null,
    erros: erros.map((e) => ({
      codigo: e.erroCodigo, quantidade: e._count, explicacao: explicarErroMeta(e.erroCodigo),
    })),
    porTemplate: templates.map((t) => {
      const q = (st: string) => porTemplate.filter((p) => p.templateId === t.id && p.status === st).reduce((s, p) => s + p._count, 0);
      const tot = q("SENT") + q("DELIVERED") + q("READ") + q("FAILED");
      return { template: t.nomeTemplateMeta, total: tot, entregues: q("DELIVERED") + q("READ"), lidos: q("READ"), falhas: q("FAILED") };
    }).filter((t) => t.total > 0),
    // Envios gravados sem wamid (token ausente na época, etc.) não podem receber status
    semRastreio,
    // Se nenhum status chegou nunca, o webhook pode não estar inscrito em "messages"
    recebeuStatusAlgumaVez: Boolean(ultimaAtualizacao),
  });
}
