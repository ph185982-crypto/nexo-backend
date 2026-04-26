import { prisma } from "@/lib/prisma/client";

// ─── Return types ─────────────────────────────────────────────────────────────

export interface VendasStats {
  confirmadas: number;
  pedidos: Array<{ title: string; body: string; createdAt: Date }>;
}

export interface ObjecoesStats {
  caro: number;
  prazo: number;
  desconfianca: number;
  concorrente: number;
}

export interface QualidadeStats {
  total: number;
  quentes: number;
  perdidos: number;
  confirmados: number;
  foraArea: number;
}

export interface LeadContato {
  phoneNumber: string;
  profileName: string | null;
  createdAt: Date;
}

export interface ProviderInfo {
  businessPhoneNumberId: string;
  accessToken: string | null;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class AdminRepository {
  async getVendasHoje(): Promise<VendasStats> {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const [confirmadas, pedidos] = await Promise.all([
      prisma.whatsappConversation.count({
        where: { etapa: "PEDIDO_CONFIRMADO", updatedAt: { gte: since } },
      }),
      prisma.ownerNotification.findMany({
        where: { type: "ORDER", createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { title: true, body: true, createdAt: true },
      }),
    ]);
    return { confirmadas, pedidos };
  }

  async getLeadsAtivos(): Promise<number> {
    return prisma.lead.count({ where: { status: "OPEN" } });
  }

  async getLeadsAtendidos(hours = 24): Promise<number> {
    const since = new Date(Date.now() - hours * 3_600_000);
    return prisma.whatsappMessage
      .findMany({
        where: { role: "USER", sentAt: { gte: since } },
        distinct: ["conversationId"],
        select: { conversationId: true },
      })
      .then((r) => r.length);
  }

  async getLeadsPerdidos(hours = 24): Promise<number> {
    const since = new Date(Date.now() - hours * 3_600_000);
    return prisma.whatsappConversation.count({
      where: {
        OR: [
          { etapa: "PERDIDO", updatedAt: { gte: since } },
          { foraAreaEntrega: true, updatedAt: { gte: since } },
        ],
      },
    });
  }

  async getObjecoes(hours = 24): Promise<ObjecoesStats> {
    const since = new Date(Date.now() - hours * 3_600_000);
    const [caro, prazo, desconfianca, concorrente] = await Promise.all([
      prisma.whatsappMessage.count({
        where: { role: "USER", sentAt: { gte: since }, content: { contains: "caro", mode: "insensitive" } },
      }),
      prisma.whatsappMessage.count({
        where: { role: "USER", sentAt: { gte: since }, content: { contains: "prazo", mode: "insensitive" } },
      }),
      prisma.whatsappMessage.count({
        where: {
          role: "USER",
          sentAt: { gte: since },
          OR: [
            { content: { contains: "golpe", mode: "insensitive" } },
            { content: { contains: "confia", mode: "insensitive" } },
            { content: { contains: "real", mode: "insensitive" } },
          ],
        },
      }),
      prisma.whatsappMessage.count({
        where: {
          role: "USER",
          sentAt: { gte: since },
          OR: [
            { content: { contains: "mercado livre", mode: "insensitive" } },
            { content: { contains: "shopee", mode: "insensitive" } },
            { content: { contains: "amazon", mode: "insensitive" } },
          ],
        },
      }),
    ]);
    return { caro, prazo, desconfianca, concorrente };
  }

  async getQualidadeLeads(hours = 24): Promise<QualidadeStats> {
    const since = new Date(Date.now() - hours * 3_600_000);
    const [total, quentes, perdidos, confirmados, foraArea] = await Promise.all([
      prisma.lead.count({ where: { createdAt: { gte: since } } }),
      prisma.whatsappConversation.count({
        where: {
          etapa: { in: ["NEGOCIANDO", "COLETANDO_DADOS", "PEDIDO_CONFIRMADO"] },
          updatedAt: { gte: since },
        },
      }),
      prisma.whatsappConversation.count({ where: { etapa: "PERDIDO", updatedAt: { gte: since } } }),
      prisma.whatsappConversation.count({ where: { etapa: "PEDIDO_CONFIRMADO", updatedAt: { gte: since } } }),
      prisma.whatsappConversation.count({ where: { foraAreaEntrega: true, updatedAt: { gte: since } } }),
    ]);
    return { total, quentes, perdidos, confirmados, foraArea };
  }

  async getNumeroClientes(limit = 10): Promise<LeadContato[]> {
    const since = new Date(Date.now() - 24 * 3_600_000);
    return prisma.lead.findMany({
      where: { status: "OPEN", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { phoneNumber: true, profileName: true, createdAt: true },
    });
  }

  async getProviderConfig(): Promise<ProviderInfo | null> {
    return prisma.whatsappProviderConfig.findFirst({
      select: { businessPhoneNumberId: true, accessToken: true },
    });
  }

  async getBastaoNumber(): Promise<string> {
    const config = await prisma.agentConfig.findFirst({
      select: { bastaoNumber: true },
    });
    return config?.bastaoNumber ?? "5562984465388";
  }
}

export const adminRepository = new AdminRepository();
