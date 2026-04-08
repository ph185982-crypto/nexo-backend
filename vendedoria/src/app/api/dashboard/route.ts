import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? "today";

  const now = new Date();
  let since: Date;
  switch (period) {
    case "7d":  since = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000); break;
    case "30d": since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
    default: { // today — desde meia-noite em São Paulo
      const sp = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      sp.setHours(0, 0, 0, 0);
      since = new Date(now.getTime() - (new Date().getTime() - sp.getTime()));
      break;
    }
  }

  const [
    totalConversas,
    pedidosConfirmados,
    escalados,
    perdidos,
    foraArea,
    conversasAtivas,
    totalMsgsClientes,
    recentConversations,
    funnelData,
  ] = await Promise.all([
    // Total de novas conversas
    prisma.whatsappConversation.count({ where: { createdAt: { gte: since } } }),

    // Pedidos confirmados (etapa alcançada no período)
    prisma.whatsappConversation.count({
      where: { etapa: "PEDIDO_CONFIRMADO", updatedAt: { gte: since } },
    }),

    // Escalados para humano
    prisma.lead.count({ where: { status: "ESCALATED", updatedAt: { gte: since } } }),

    // Perdidos/desistências
    prisma.whatsappConversation.count({
      where: { etapa: "PERDIDO", updatedAt: { gte: since } },
    }),

    // Fora da área de entrega
    prisma.whatsappConversation.count({
      where: { foraAreaEntrega: true, updatedAt: { gte: since } },
    }),

    // Conversas ativas em andamento (mensagem nas últimas 48h)
    prisma.whatsappConversation.count({
      where: {
        isActive: true,
        etapa: { notIn: ["PEDIDO_CONFIRMADO", "PERDIDO"] },
        foraAreaEntrega: false,
        lastMessageAt: { gte: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
      },
    }),

    // Total de mensagens de clientes no período
    prisma.whatsappMessage.count({ where: { role: "USER", sentAt: { gte: since } } }),

    // Últimas 15 conversas com atividade
    prisma.whatsappConversation.findMany({
      where: { lastMessageAt: { gte: since } },
      orderBy: { lastMessageAt: "desc" },
      take: 15,
      select: {
        id: true,
        profileName: true,
        customerWhatsappBusinessId: true,
        etapa: true,
        foraAreaEntrega: true,
        humanTakeover: true,
        lastMessageAt: true,
        lead: { select: { status: true } },
        messages: {
          orderBy: { sentAt: "desc" },
          take: 1,
          select: { content: true, role: true },
        },
      },
    }),

    // Funil de conversão por etapa
    prisma.whatsappConversation.groupBy({
      by: ["etapa"],
      _count: { id: true },
      where: { createdAt: { gte: since } },
    }),
  ]);

  // Taxa de conversão
  const taxaConversao = totalConversas > 0
    ? Math.round((pedidosConfirmados / totalConversas) * 100)
    : 0;

  // Funil formatado
  const etapaOrder = [
    "NOVO", "PRODUTO_IDENTIFICADO", "MIDIA_ENVIADA",
    "QUALIFICANDO", "NEGOCIANDO", "COLETANDO_DADOS",
    "PEDIDO_CONFIRMADO", "PERDIDO",
  ];
  const funnelFormatted = etapaOrder.map((etapa) => ({
    etapa,
    count: funnelData.find((f) => f.etapa === etapa)?._count.id ?? 0,
  }));

  return NextResponse.json({
    period,
    stats: {
      totalConversas,
      pedidosConfirmados,
      taxaConversao,
      escalados,
      perdidos,
      foraArea,
      conversasAtivas,
      totalMsgsClientes,
    },
    funnel: funnelFormatted,
    recentConversations: recentConversations.map((c) => ({
      id: c.id,
      name: c.profileName ?? c.customerWhatsappBusinessId,
      phone: c.customerWhatsappBusinessId,
      etapa: c.etapa,
      foraAreaEntrega: c.foraAreaEntrega,
      humanTakeover: c.humanTakeover,
      leadStatus: c.lead?.status ?? "OPEN",
      lastMessageAt: c.lastMessageAt,
      lastMessage: c.messages[0]?.content?.slice(0, 60) ?? "",
      lastMessageRole: c.messages[0]?.role ?? "USER",
    })),
  });
}
