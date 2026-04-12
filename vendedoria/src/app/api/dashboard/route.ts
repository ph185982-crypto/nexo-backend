import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

const AVG_PRODUCT_PRICE = 539.99;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const organizationId = searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [leadsToday, allLeads, pedidosHoje, convs] = await Promise.all([
    prisma.lead.count({ where: { organizationId, createdAt: { gte: todayStart } } }),
    prisma.lead.findMany({
      where: { organizationId, status: { in: ["OPEN", "ESCALATED"] } },
      include: {
        conversations: {
          take: 1, orderBy: { lastMessageAt: "desc" },
          select: { etapa: true, lastMessageAt: true, humanTakeover: true },
        },
      },
    }),
    prisma.whatsappConversation.count({
      where: { provider: { organizationId }, etapa: "PEDIDO_CONFIRMADO", updatedAt: { gte: todayStart } },
    }),
    prisma.whatsappConversation.findMany({
      where: { provider: { organizationId } },
      select: { etapa: true, lastMessageAt: true },
    }),
  ]);

  const [totalLeads, closedLeads] = await Promise.all([
    prisma.lead.count({ where: { organizationId } }),
    prisma.lead.count({ where: { organizationId, status: "CLOSED" } }),
  ]);

  const taxaConversao = totalLeads > 0 ? Math.round((closedLeads / totalLeads) * 100) : 0;
  const receitaEstimada = pedidosHoje * AVG_PRODUCT_PRICE;

  // Brasília offset UTC-3
  const brNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const hora = brNow.getUTCHours();
  const diaSemana = brNow.getUTCDay();
  const horarioComercial =
    (diaSemana >= 1 && diaSemana <= 5 && hora >= 9 && hora < 18) ||
    (diaSemana === 6 && hora >= 8 && hora < 13);

  const umHoraAtras = new Date(now.getTime() - 60 * 60 * 1000);
  const alertas = horarioComercial
    ? allLeads
        .filter((l) => { const lm = l.conversations[0]?.lastMessageAt; return lm && new Date(lm) < umHoraAtras; })
        .slice(0, 10)
        .map((l) => ({
          leadId: l.id, name: l.profileName ?? l.phoneNumber,
          etapa: l.conversations[0]?.etapa ?? "NOVO",
          lastMessageAt: l.conversations[0]?.lastMessageAt, tipo: "parado_1h",
        }))
    : [];

  const ETAPAS = ["NOVO","PRODUTO_IDENTIFICADO","QUALIFICANDO","NEGOCIANDO","COLETANDO_DADOS","PEDIDO_CONFIRMADO","PERDIDO"];
  const funil = ETAPAS.map((e) => ({ etapa: e, count: convs.filter((c) => c.etapa === e).length }));

  const dias7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayStart); d.setDate(d.getDate() - (6 - i)); return d;
  });
  const conversao7d = dias7.map((d) => {
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const total = convs.filter((c) => c.lastMessageAt && new Date(c.lastMessageAt) >= d && new Date(c.lastMessageAt) < next).length;
    const ok = convs.filter((c) => c.etapa === "PEDIDO_CONFIRMADO" && c.lastMessageAt && new Date(c.lastMessageAt) >= d && new Date(c.lastMessageAt) < next).length;
    return { date: d.toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit" }), taxa: total > 0 ? Math.round((ok/total)*100) : 0 };
  });

  return NextResponse.json({
    metricas: { leadsToday, ativosAgora: allLeads.length, pedidosHoje, taxaConversao, receitaEstimada },
    alertas, funil, conversao7d,
  });
}
