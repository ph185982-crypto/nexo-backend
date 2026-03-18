import { prisma } from "@/lib/prisma/client";
import { Prisma } from "@prisma/client";
import { GraphQLScalarType, Kind } from "graphql";
import bcrypt from "bcryptjs";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

interface ResolverContext {
  userId?: string;
  userRole?: string;
  allowedOrgIds: string[];
}

function requireAuth(ctx: ResolverContext): void {
  if (!ctx.userId) throw new Error("Não autenticado");
}

function requireOrgAccess(ctx: ResolverContext, organizationId: string): void {
  requireAuth(ctx);
  if (ctx.allowedOrgIds.length > 0 && !ctx.allowedOrgIds.includes(organizationId)) {
    throw new Error("Acesso negado: organização não autorizada");
  }
}

/** Fetch lead and verify caller has access to its org */
async function requireLeadAccess(ctx: ResolverContext, leadId: string): Promise<void> {
  requireAuth(ctx);
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { organizationId: true } });
  if (!lead) throw new Error("Lead não encontrado");
  requireOrgAccess(ctx, lead.organizationId);
}

/** Fetch campaign and verify caller has access to its org */
async function requireCampaignAccess(ctx: ResolverContext, campaignId: string): Promise<void> {
  requireAuth(ctx);
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { organizationId: true } });
  if (!campaign) throw new Error("Campanha não encontrada");
  requireOrgAccess(ctx, campaign.organizationId);
}

/** Fetch calendar event and verify caller has access to its org */
async function requireCalendarEventAccess(ctx: ResolverContext, eventId: string): Promise<void> {
  requireAuth(ctx);
  const event = await prisma.calendarEvent.findUnique({ where: { id: eventId }, select: { organizationId: true } });
  if (!event) throw new Error("Evento não encontrado");
  requireOrgAccess(ctx, event.organizationId);
}

/** Fetch profissional and verify caller has access to its org */
async function requireProfissionalAccess(ctx: ResolverContext, profId: string): Promise<void> {
  requireAuth(ctx);
  const prof = await prisma.profissionalEntity.findUnique({ where: { id: profId }, select: { organizationId: true } });
  if (!prof) throw new Error("Profissional não encontrado");
  requireOrgAccess(ctx, prof.organizationId);
}

/** Fetch work unit and verify caller has access to its org */
async function requireWorkUnitAccess(ctx: ResolverContext, unitId: string): Promise<void> {
  requireAuth(ctx);
  const unit = await prisma.workUnitEntity.findUnique({ where: { id: unitId }, select: { organizationId: true } });
  if (!unit) throw new Error("Unidade de trabalho não encontrada");
  requireOrgAccess(ctx, unit.organizationId);
}

const DateTimeScalar = new GraphQLScalarType({
  name: "DateTime",
  serialize: (value: unknown) => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return value;
    return null;
  },
  parseValue: (value: unknown) => {
    if (typeof value === "string") return new Date(value);
    return null;
  },
  parseLiteral: (ast) => {
    if (ast.kind === Kind.STRING) return new Date(ast.value);
    return null;
  },
});

const JSONScalar = new GraphQLScalarType({
  name: "JSON",
  serialize: (value: unknown) => value,
  parseValue: (value: unknown) => value,
  parseLiteral: (ast) => {
    if (ast.kind === Kind.STRING) {
      try { return JSON.parse(ast.value); } catch { return ast.value; }
    }
    return null;
  },
});

export const resolvers = {
  DateTime: DateTimeScalar,
  JSON: JSONScalar,

  Query: {
    // Dashboard
    widgetsData: async (
      _: unknown,
      { timeFilter, whatsappProviderConfigId }: { timeFilter?: string; whatsappProviderConfigId?: string },
      ctx: ResolverContext
    ) => {
      requireAuth(ctx);
      const now = new Date();
      let since: Date | undefined;
      if (timeFilter === "today") {
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (timeFilter === "7d") {
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (timeFilter === "15d") {
        since = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
      } else if (timeFilter === "30d") {
        since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const where = {
        ...(since && { createdAt: { gte: since } }),
        ...(whatsappProviderConfigId && { whatsappProviderConfigId }),
      };

      const leadWhere = since ? { createdAt: { gte: since } } : {};
      const [uniqueConvs, leadsQuentes, allConvs, repassados] = await Promise.all([
        prisma.whatsappConversation.count({ where }),
        prisma.lead.count({
          where: { status: "OPEN", ...leadWhere },
        }),
        prisma.whatsappConversation.count({ where }),
        prisma.lead.count({
          where: { status: "ESCALATED", ...leadWhere },
        }),
      ]);

      return {
        uniqueWhatsappConversations: uniqueConvs,
        leadsQuentes,
        conversationWindowsOpened: allConvs,
        repassados,
        contactsSentDocs: Math.floor(uniqueConvs * 0.2),
        regionStatistics: [],
      };
    },

    // Organizations
    whatsappBusinessOrganizations: async (
      _: unknown,
      { input }: { input?: { search?: string; status?: string } },
      ctx: ResolverContext
    ) => {
      requireAuth(ctx);
      return prisma.whatsappBusinessOrganization.findMany({
        where: {
          ...(input?.status && { status: input.status }),
          ...(input?.search && {
            name: { contains: input.search, mode: "insensitive" },
          }),
        },
        include: { accounts: { include: { agent: true } } },
        orderBy: { createdAt: "desc" },
      });
    },

    whatsappAccounts: async (
      _: unknown,
      { organizationId }: { organizationId: string },
      ctx: ResolverContext
    ) => {
      requireOrgAccess(ctx, organizationId);
      return prisma.whatsappProviderConfig.findMany({
        where: { organizationId },
        include: { agent: true },
      });
    },

    hierarchyItems: async (
      _: unknown,
      { organizationId }: { organizationId: string },
      ctx: ResolverContext
    ) => {
      requireOrgAccess(ctx, organizationId);
      const items = await prisma.orgHierarchyItem.findMany({
        where: { organizationId, parentId: null },
        include: {
          agent: true,
          children: {
            include: {
              agent: true,
              children: { include: { agent: true } },
            },
          },
        },
        orderBy: { order: "asc" },
      });
      return items;
    },

    // Kanban
    getKanbanBoard: async (
      _: unknown,
      {
        organizationId,
        leadsPerColumn = 20,
        cursor,
        filters,
      }: {
        organizationId: string;
        leadsPerColumn?: number;
        cursor?: string;
        filters?: { leadStatus?: string; leadOrigin?: string; periodDays?: number };
      },
      ctx: ResolverContext
    ) => {
      requireOrgAccess(ctx, organizationId);
      const columns = await prisma.kanbanColumn.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
      });

      const leadWhere: Record<string, unknown> = {};
      if (filters?.leadOrigin) leadWhere.leadOrigin = filters.leadOrigin;
      if (filters?.leadStatus) leadWhere.status = filters.leadStatus;
      if (filters?.periodDays) {
        leadWhere.createdAt = {
          gte: new Date(Date.now() - filters.periodDays * 24 * 60 * 60 * 1000),
        };
      }

      const columnIds = columns.map((c) => c.id);

      // 1 groupBy query for all column counts (replaces N individual count queries)
      const countRows = await prisma.lead.groupBy({
        by: ["kanbanColumnId"],
        where: { kanbanColumnId: { in: columnIds }, ...leadWhere },
        _count: { id: true },
      });
      const countMap = new Map(countRows.map((r) => [r.kanbanColumnId, r._count.id]));

      // N findMany queries — all run in parallel, no redundant kanbanColumn JOIN
      const leadsPerColumn_results = await Promise.all(
        columns.map((col) =>
          prisma.lead.findMany({
            where: { kanbanColumnId: col.id, ...leadWhere },
            include: { tags: { include: { tag: true } } },
            orderBy: { createdAt: "desc" },
            take: leadsPerColumn + 1,
            ...(cursor && { cursor: { id: cursor }, skip: 1 }),
          })
        )
      );

      const columnsWithLeads = columns.map((col, i) => {
        const leads = leadsPerColumn_results[i];
        const hasMore = leads.length > leadsPerColumn;
        const paginatedLeads = hasMore ? leads.slice(0, leadsPerColumn) : leads;
        const nextCursor = hasMore ? paginatedLeads[paginatedLeads.length - 1].id : null;

        return {
          ...col,
          totalLeadsCount: countMap.get(col.id) ?? 0,
          hasMoreLeads: hasMore,
          nextCursor,
          leads: paginatedLeads.map((l) => ({
            ...l,
            tags: l.tags.map((lt) => lt.tag),
            kanbanColumn: { id: col.id, name: col.name, color: col.color, type: col.type },
          })),
        };
      });

      return { columns: columnsWithLeads };
    },

    // Conversations
    getConversationsByWhatsappAccount: async (
      _: unknown,
      {
        accountId,
        cursor,
        filters,
      }: {
        accountId: string;
        cursor?: string;
        filters?: { leadStatus?: string; leadOrigin?: string; periodDays?: number };
      }
    ) => {
      const PAGE_SIZE = 30;
      const where: Record<string, unknown> = { whatsappProviderConfigId: accountId };
      if (filters?.leadOrigin) where.leadOrigin = filters.leadOrigin;
      if (filters?.periodDays) {
        where.createdAt = {
          gte: new Date(Date.now() - filters.periodDays * 24 * 60 * 60 * 1000),
        };
      }

      const total = await prisma.whatsappConversation.count({ where });
      const conversations = await prisma.whatsappConversation.findMany({
        where,
        include: {
          tags: { include: { tag: true } },
          lead: true,
          messages: { orderBy: { sentAt: "desc" }, take: 1 },
        },
        orderBy: { lastMessageAt: "desc" },
        take: PAGE_SIZE + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });

      const hasMore = conversations.length > PAGE_SIZE;
      const paginated = hasMore ? conversations.slice(0, PAGE_SIZE) : conversations;
      const nextCursor = hasMore ? paginated[paginated.length - 1].id : null;

      // Fix 6: Count real unread messages (USER role, not yet READ status)
      const convIds = paginated.map((c) => c.id);
      const unreadCounts = await prisma.whatsappMessage.groupBy({
        by: ["conversationId"],
        where: {
          conversationId: { in: convIds },
          role: "USER",
          status: { not: "READ" },
        },
        _count: { id: true },
      });
      const unreadMap = new Map(unreadCounts.map((r) => [r.conversationId, r._count.id]));

      return {
        conversations: paginated.map((c) => ({
          ...c,
          tags: c.tags.map((ct) => ct.tag),
          lastMessage: c.messages[0] ?? null,
          unreadCount: unreadMap.get(c.id) ?? 0,
        })),
        hasMore,
        nextCursor,
        total,
      };
    },

    getConversationMessages: async (
      _: unknown,
      { conversationId, cursor }: { conversationId: string; cursor?: string }
    ) => {
      const PAGE_SIZE = 50;
      const messages = await prisma.whatsappMessage.findMany({
        where: { conversationId },
        orderBy: { sentAt: "desc" },
        take: PAGE_SIZE + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });

      const hasMore = messages.length > PAGE_SIZE;
      const paginated = hasMore ? messages.slice(0, PAGE_SIZE) : messages;
      const nextCursor = hasMore ? paginated[paginated.length - 1].id : null;

      // Mark all USER messages in this conversation as READ when operator opens it
      // Run in background — don't await to avoid slowing the response
      prisma.whatsappMessage.updateMany({
        where: { conversationId, role: "USER", status: { not: "READ" } },
        data: { status: "READ" },
      }).catch(() => {});

      return {
        messages: paginated.reverse(),
        hasMore,
        nextCursor,
      };
    },

    getConversationsByLead: async (
      _: unknown,
      { leadId }: { leadId: string }
    ) => {
      const conversations = await prisma.whatsappConversation.findMany({
        where: { leadId },
        include: {
          tags: { include: { tag: true } },
          lead: true,
          provider: true,
          messages: { orderBy: { sentAt: "desc" }, take: 1 },
        },
        orderBy: { lastMessageAt: "desc" },
      });

      return conversations.map((c) => ({
        ...c,
        tags: c.tags.map((ct) => ct.tag),
        lastMessage: c.messages[0] ?? null,
        unreadCount: 0,
      }));
    },

    // Campaigns
    getCampaigns: async (
      _: unknown,
      {
        organizationId,
        status,
        search,
        periodDays,
      }: { organizationId: string; status?: string; search?: string; periodDays?: number },
      ctx: ResolverContext
    ) => {
      requireOrgAccess(ctx, organizationId);
      const where: Record<string, unknown> = { organizationId };
      if (status && status !== "ALL") where.status = status;
      if (search) where.name = { contains: search, mode: "insensitive" };
      if (periodDays) {
        where.createdAt = {
          gte: new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000),
        };
      }

      const [campaigns, total] = await Promise.all([
        prisma.campaign.findMany({
          where,
          include: {
            sender: true,
            recipients: { select: { status: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.campaign.count({ where }),
      ]);

      return {
        campaigns: campaigns.map((c) => ({
          ...c,
          totalRecipients: c.recipients.length,
          sentCount: c.recipients.filter((r) => r.status === "SENT").length,
          failedCount: c.recipients.filter((r) => r.status === "FAILED").length,
          repliedCount: c.recipients.filter((r) => r.status === "REPLIED").length,
        })),
        total,
      };
    },

    getCampaign: async (_: unknown, { id }: { id: string }) => {
      const campaign = await prisma.campaign.findUnique({
        where: { id },
        include: {
          sender: { include: { agent: true } },
          recipients: { select: { status: true } },
        },
      });
      if (!campaign) return null;
      return {
        ...campaign,
        totalRecipients: campaign.recipients.length,
        sentCount: campaign.recipients.filter((r) => r.status === "SENT").length,
        failedCount: campaign.recipients.filter((r) => r.status === "FAILED").length,
        repliedCount: campaign.recipients.filter((r) => r.status === "REPLIED").length,
      };
    },

    getCampaignStats: async (_: unknown, { id }: { id: string }) => {
      const recipients = await prisma.campaignRecipient.findMany({
        where: { campaignId: id },
        select: { status: true },
      });
      const total = recipients.length;
      const sent = recipients.filter((r) => r.status === "SENT").length;
      const failed = recipients.filter((r) => r.status === "FAILED").length;
      const replied = recipients.filter((r) => r.status === "REPLIED").length;
      return {
        totalRecipients: total,
        sent,
        failed,
        replied,
        successRate: total > 0 ? (sent / total) * 100 : 0,
        replyRate: sent > 0 ? (replied / sent) * 100 : 0,
      };
    },

    campaignReplyRate: async (
      _: unknown,
      { id }: { id: string }
    ) => {
      const recipients = await prisma.campaignRecipient.findMany({
        where: { campaignId: id, status: { in: ["SENT", "REPLIED"] } },
        select: { status: true, sentAt: true },
      });

      // Group by sentAt date
      const byDate = new Map<string, { sent: number; replied: number }>();
      for (const r of recipients) {
        if (!r.sentAt) continue;
        const date = r.sentAt.toISOString().split("T")[0];
        const slot = byDate.get(date) ?? { sent: 0, replied: 0 };
        if (r.status === "SENT") slot.sent++;
        if (r.status === "REPLIED") slot.replied++;
        byDate.set(date, slot);
      }

      // Return last 7 days (filling missing days with zeros)
      const days = 7;
      return Array.from({ length: days }, (_, i) => {
        const d = new Date(Date.now() - (days - i - 1) * 24 * 60 * 60 * 1000);
        const date = d.toISOString().split("T")[0];
        const data = byDate.get(date) ?? { sent: 0, replied: 0 };
        return { date, ...data };
      });
    },

    getCampaignRecipientsTable: async (
      _: unknown,
      { id, page = 1, pageSize = 50 }: { id: string; page?: number; pageSize?: number }
    ) => {
      const [recipients, total] = await Promise.all([
        prisma.campaignRecipient.findMany({
          where: { campaignId: id },
          orderBy: { sentAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.campaignRecipient.count({ where: { campaignId: id } }),
      ]);
      return { recipients, total, page, pageSize };
    },

    checkWhatsappProviderConfigHealth: async (
      _: unknown,
      { id }: { id: string }
    ) => {
      const config = await prisma.whatsappProviderConfig.findUnique({ where: { id } });
      return {
        status: config?.status === "CONNECTED" ? "HEALTHY" : "UNHEALTHY",
        lastCheckedAt: new Date(),
        message: config?.status === "CONNECTED" ? "Conexão estável" : "Desconectado",
      };
    },

    // Calendar
    listCalendarEvents: async (
      _: unknown,
      { organizationId, month, year }: { organizationId: string; month: number; year: number },
      ctx: ResolverContext
    ) => {
      requireOrgAccess(ctx, organizationId);
      const startOfMonth = new Date(year, month - 1, 1);
      const endOfMonth = new Date(year, month, 0, 23, 59, 59);
      return prisma.calendarEvent.findMany({
        where: {
          organizationId,
          startTime: { gte: startOfMonth, lte: endOfMonth },
        },
        include: { attendees: true },
        orderBy: { startTime: "asc" },
      });
    },

    getCalendarKpis: async (
      _: unknown,
      { organizationId }: { organizationId: string },
      ctx: ResolverContext
    ) => {
      requireOrgAccess(ctx, organizationId);
      const today = new Date();
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
      const startOfWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [scheduledToday, scheduledWeek, completed, cancelled, pending] = await Promise.all([
        prisma.calendarEvent.count({
          where: {
            organizationId,
            startTime: { gte: startOfToday, lte: endOfToday },
            status: "SCHEDULED",
          },
        }),
        prisma.calendarEvent.count({
          where: {
            organizationId,
            startTime: { gte: startOfWeek },
            status: "SCHEDULED",
          },
        }),
        prisma.calendarEvent.count({ where: { organizationId, status: "COMPLETED" } }),
        prisma.calendarEvent.count({ where: { organizationId, status: "CANCELLED" } }),
        prisma.calendarEvent.count({ where: { organizationId, status: "SCHEDULED" } }),
      ]);

      return { scheduledToday, scheduledWeek, completed, cancelled, pending };
    },

    searchLeadsForScheduling: async (
      _: unknown,
      { query, organizationId }: { query: string; organizationId: string }
    ) => {
      return prisma.lead.findMany({
        where: {
          organizationId,
          OR: [
            { profileName: { contains: query, mode: "insensitive" } },
            { phoneNumber: { contains: query } },
            { cpf: { contains: query } },
          ],
        },
        take: 10,
      });
    },

    listWorkUnits: async (
      _: unknown,
      { organizationId, search }: { organizationId: string; search?: string },
      ctx: ResolverContext
    ) => {
      requireOrgAccess(ctx, organizationId);
      const units = await prisma.workUnitEntity.findMany({
        where: {
          organizationId,
          ...(search && {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { address: { contains: search, mode: "insensitive" } },
            ],
          }),
        },
        include: { professionals: true },
        orderBy: { name: "asc" },
      });
      return units.map((u) => ({
        ...u,
        professionalCount: u.professionals.length,
      }));
    },

    listProfissionais: async (
      _: unknown,
      { organizationId, search }: { organizationId: string; search?: string },
      ctx: ResolverContext
    ) => {
      requireOrgAccess(ctx, organizationId);
      const profs = await prisma.profissionalEntity.findMany({
        where: {
          organizationId,
          ...(search && {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { workField: { contains: search, mode: "insensitive" } },
            ],
          }),
        },
        include: {
          availabilities: true,
          workProfiles: true,
        },
        orderBy: { name: "asc" },
      });
      return profs.map((p) => ({
        ...p,
        workUnitCount: p.workProfiles.length,
      }));
    },

    getProfissional: async (_: unknown, { id }: { id: string }) => {
      const prof = await prisma.profissionalEntity.findUnique({
        where: { id },
        include: { availabilities: true, workProfiles: true },
      });
      if (!prof) return null;
      return { ...prof, workUnitCount: prof.workProfiles.length };
    },
  },

  Mutation: {
    createLead: async (_: unknown, { input }: { input: Record<string, unknown> }, ctx: ResolverContext) => {
      requireOrgAccess(ctx, input.organizationId as string);
      // Find or use provided kanban column
      let kanbanColumnId = input.kanbanColumnId as string;
      if (!kanbanColumnId) {
        const defaultCol = await prisma.kanbanColumn.findFirst({
          where: { organizationId: input.organizationId as string, isDefaultEntry: true },
        });
        kanbanColumnId = defaultCol?.id ?? "";
      }

      const lead = await prisma.lead.create({
        data: {
          phoneNumber: input.phoneNumber as string,
          profileName: input.profileName as string | undefined,
          email: input.email as string | undefined,
          leadOrigin: input.leadOrigin as string,
          organizationId: input.organizationId as string,
          kanbanColumnId,
        },
      });
      return lead;
    },

    updateLead: async (
      _: unknown,
      { leadId, input }: { leadId: string; input: Record<string, unknown> },
      ctx: ResolverContext
    ) => {
      await requireLeadAccess(ctx, leadId);
      return prisma.lead.update({
        where: { id: leadId },
        data: {
          ...(input.phoneNumber !== undefined && { phoneNumber: input.phoneNumber as string }),
          ...(input.profileName !== undefined && { profileName: input.profileName as string | null }),
          ...(input.email !== undefined && { email: input.email as string | null }),
          ...(input.leadOrigin !== undefined && { leadOrigin: input.leadOrigin as string }),
          lastActivityAt: new Date(),
        },
        include: { kanbanColumn: true, tags: { include: { tag: true } } },
      }).then((l) => ({ ...l, tags: l.tags.map((lt) => lt.tag) }));
    },

    updateLeadKanbanColumn: async (
      _: unknown,
      { leadId, columnId }: { leadId: string; columnId: string },
      ctx: ResolverContext
    ) => {
      await requireLeadAccess(ctx, leadId);
      return prisma.lead.update({
        where: { id: leadId },
        data: { kanbanColumnId: columnId, lastActivityAt: new Date() },
        include: { kanbanColumn: true },
      });
    },

    updateLeadTags: async (
      _: unknown,
      { leadId, tagIds }: { leadId: string; tagIds: string[] },
      ctx: ResolverContext
    ) => {
      await requireLeadAccess(ctx, leadId);
      await prisma.leadTag.deleteMany({ where: { leadId } });
      await prisma.leadTag.createMany({
        data: tagIds.map((tagId) => ({ leadId, tagId })),
      });
      return prisma.lead.findUnique({
        where: { id: leadId },
        include: { tags: { include: { tag: true } } },
      });
    },

    blockLead: async (
      _: unknown,
      { leadId }: { leadId: string },
      ctx: ResolverContext
    ) => {
      await requireLeadAccess(ctx, leadId);
      return prisma.lead.update({
        where: { id: leadId },
        data: { status: "BLOCKED" },
      });
    },

    closeLead: async (_: unknown, { leadId }: { leadId: string }, ctx: ResolverContext) => {
      await requireLeadAccess(ctx, leadId);
      return prisma.lead.update({
        where: { id: leadId },
        data: { status: "CLOSED" },
      });
    },

    addLeadActivity: async (
      _: unknown,
      {
        leadId,
        type,
        description,
      }: { leadId: string; type: string; description: string },
      ctx: ResolverContext
    ) => {
      await requireLeadAccess(ctx, leadId);
      return prisma.leadActivity.create({
        data: { leadId, type, description },
      });
    },

    sendWhatsappMessage: async (
      _: unknown,
      { conversationId, content }: { conversationId: string; content: string },
      ctx: ResolverContext
    ) => {
      requireAuth(ctx);

      // Look up conversation + provider to get phone number ID and access token
      const conversation = await prisma.whatsappConversation.findUnique({
        where: { id: conversationId },
        include: { provider: true },
      });

      if (!conversation) throw new Error("Conversa não encontrada");
      requireOrgAccess(ctx, conversation.provider.organizationId);

      // Save message to DB first
      const message = await prisma.whatsappMessage.create({
        data: {
          content,
          type: "TEXT",
          role: "ASSISTANT",
          sentAt: new Date(),
          status: "SENDING",
          conversationId,
        },
      });

      await prisma.whatsappConversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });

      // Send via Meta WhatsApp API
      try {
        await sendWhatsAppMessage(
          conversation.provider.businessPhoneNumberId,
          conversation.customerWhatsappBusinessId,
          content,
          conversation.provider.accessToken ?? undefined
        );
        // Update status to SENT
        await prisma.whatsappMessage.update({
          where: { id: message.id },
          data: { status: "SENT" },
        });
      } catch (err) {
        console.error("[sendWhatsappMessage] Meta API error:", err);
        await prisma.whatsappMessage.update({
          where: { id: message.id },
          data: { status: "FAILED" },
        });
      }

      return { ...message, status: "SENT" };
    },

    createCampaign: async (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: ResolverContext
    ) => {
      requireOrgAccess(ctx, input.organizationId as string);
      const { recipients, ...data } = input as {
        recipients: Array<{ phoneNumber: string; name?: string; metadata?: unknown }>;
        [key: string]: unknown;
      };

      const campaign = await prisma.campaign.create({
        data: {
          name: data.name as string,
          objective: data.objective as string,
          mode: (data.mode as string) || "DEFAULT",
          triggerType: (data.triggerType as string) || "SCHEDULED",
          scheduledAt: data.scheduledAt as Date | undefined,
          templateMessage: data.templateMessage as string,
          phoneColumn: data.phoneColumn as string | undefined,
          identificationColumn: data.identificationColumn as string | undefined,
          variableMapping: data.variableMapping as unknown as Prisma.InputJsonValue | undefined,
          minDelaySeconds: (data.minDelaySeconds as number) || 15,
          maxDelaySeconds: (data.maxDelaySeconds as number) || 45,
          maxMessagesPerMinute: (data.maxMessagesPerMinute as number) || 5,
          dailyStartTime: (data.dailyStartTime as string) || "08:00",
          dailyEndTime: (data.dailyEndTime as string) || "20:00",
          skipExistingConversation: data.skipExistingConversation as boolean ?? true,
          organizationId: data.organizationId as string,
          senderId: data.senderId as string,
          recipients: {
            create: recipients.map((r) => ({
              phoneNumber: r.phoneNumber,
              name: r.name,
              metadata: r.metadata as unknown as Prisma.InputJsonValue | undefined,
            })),
          },
        },
        include: {
          sender: true,
          recipients: { select: { status: true } },
        },
      });

      return {
        ...campaign,
        totalRecipients: campaign.recipients.length,
        sentCount: 0,
        failedCount: 0,
        repliedCount: 0,
      };
    },

    startCampaign: async (_: unknown, { id }: { id: string }, ctx: ResolverContext) => {
      await requireCampaignAccess(ctx, id);
      const campaign = await prisma.campaign.update({
        where: { id },
        data: { status: "ACTIVE" },
        include: { recipients: { select: { status: true } } },
      });
      return {
        ...campaign,
        totalRecipients: campaign.recipients.length,
        sentCount: campaign.recipients.filter((r) => r.status === "SENT").length,
        failedCount: campaign.recipients.filter((r) => r.status === "FAILED").length,
        repliedCount: campaign.recipients.filter((r) => r.status === "REPLIED").length,
      };
    },

    pauseCampaign: async (_: unknown, { id }: { id: string }, ctx: ResolverContext) => {
      await requireCampaignAccess(ctx, id);
      const campaign = await prisma.campaign.update({
        where: { id },
        data: { status: "PAUSED" },
        include: { recipients: { select: { status: true } } },
      });
      return {
        ...campaign,
        totalRecipients: campaign.recipients.length,
        sentCount: campaign.recipients.filter((r) => r.status === "SENT").length,
        failedCount: campaign.recipients.filter((r) => r.status === "FAILED").length,
        repliedCount: campaign.recipients.filter((r) => r.status === "REPLIED").length,
      };
    },

    cloneCampaign: async (_: unknown, { id }: { id: string }, ctx: ResolverContext) => {
      await requireCampaignAccess(ctx, id);
      const original = await prisma.campaign.findUnique({
        where: { id },
        include: { recipients: true },
      });
      if (!original) throw new Error("Campaign not found");

      const { id: _id, createdAt: _ca, updatedAt: _ua, recipients, variableMapping: _vm, ...data } = original;
      const cloned = await prisma.campaign.create({
        data: {
          ...data,
          name: `${data.name} (Cópia)`,
          status: "PLANNING",
          variableMapping: _vm === null ? Prisma.JsonNull : (_vm as Prisma.InputJsonValue | undefined),
          recipients: {
            create: recipients.map((r) => ({
              phoneNumber: r.phoneNumber,
              name: r.name,
              status: "PENDING",
              metadata: r.metadata === null ? Prisma.JsonNull : (r.metadata as Prisma.InputJsonValue | undefined),
            })),
          },
        },
        include: { recipients: { select: { status: true } } },
      });

      return {
        ...cloned,
        totalRecipients: cloned.recipients.length,
        sentCount: 0,
        failedCount: 0,
        repliedCount: 0,
      };
    },

    createCalendarEvent: async (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: ResolverContext
    ) => {
      requireOrgAccess(ctx, input.organizationId as string);
      return prisma.calendarEvent.create({
        data: {
          title: input.title as string,
          description: input.description as string | undefined,
          location: input.location as string | undefined,
          startTime: new Date(input.startTime as string),
          endTime: new Date(input.endTime as string),
          timezone: (input.timezone as string) || "America/Sao_Paulo",
          isAllDay: (input.isAllDay as boolean) || false,
          status: "SCHEDULED",
          provider: "LOCAL",
          organizationId: input.organizationId as string,
          workUnitId: input.workUnitId as string | undefined,
          profissionalId: input.profissionalId as string | undefined,
          leadId: input.leadId as string | undefined,
          whatsappProviderConfigId: input.whatsappProviderConfigId as string | undefined,
        },
        include: { attendees: true },
      });
    },

    updateCalendarEvent: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: ResolverContext
    ) => {
      await requireCalendarEventAccess(ctx, id);
      return prisma.calendarEvent.update({
        where: { id },
        data: {
          title: input.title as string,
          description: input.description as string | undefined,
          startTime: input.startTime ? new Date(input.startTime as string) : undefined,
          endTime: input.endTime ? new Date(input.endTime as string) : undefined,
        },
        include: { attendees: true },
      });
    },

    cancelCalendarEvent: async (_: unknown, { id }: { id: string }, ctx: ResolverContext) => {
      await requireCalendarEventAccess(ctx, id);
      return prisma.calendarEvent.update({
        where: { id },
        data: { status: "CANCELLED" },
        include: { attendees: true },
      });
    },

    createProfissional: async (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: ResolverContext
    ) => {
      requireOrgAccess(ctx, input.organizationId as string);
      const { availabilities, workUnitIds, ...data } = input as {
        availabilities?: Array<{ dayOfWeek: number; startTime: string; endTime: string; breakMinutes?: number }>;
        workUnitIds?: string[];
        [key: string]: unknown;
      };

      const prof = await prisma.profissionalEntity.create({
        data: {
          name: data.name as string,
          description: data.description as string | undefined,
          workField: data.workField as string | undefined,
          isActive: (data.isActive as boolean) ?? true,
          loginEmail: data.loginEmail as string | undefined,
          organizationId: data.organizationId as string,
          availabilities: availabilities
            ? { create: availabilities }
            : undefined,
          workProfiles: workUnitIds
            ? {
                create: workUnitIds.map((wuId) => ({
                  workUnitId: wuId,
                  isActive: true,
                })),
              }
            : undefined,
        },
        include: { availabilities: true, workProfiles: true },
      });

      return { ...prof, workUnitCount: prof.workProfiles.length };
    },

    updateProfissional: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: ResolverContext
    ) => {
      await requireProfissionalAccess(ctx, id);
      const prof = await prisma.profissionalEntity.update({
        where: { id },
        data: {
          name: input.name as string | undefined,
          description: input.description as string | undefined,
          workField: input.workField as string | undefined,
          isActive: input.isActive as boolean | undefined,
          loginEmail: input.loginEmail as string | undefined,
        },
        include: { availabilities: true, workProfiles: true },
      });
      return { ...prof, workUnitCount: prof.workProfiles.length };
    },

    createWorkUnit: async (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: ResolverContext
    ) => {
      requireOrgAccess(ctx, input.organizationId as string);
      const unit = await prisma.workUnitEntity.create({
        data: {
          name: input.name as string,
          address: input.address as string | undefined,
          timezone: (input.timezone as string) || "America/Sao_Paulo",
          organizationId: input.organizationId as string,
        },
        include: { professionals: true },
      });
      return { ...unit, professionalCount: unit.professionals.length };
    },

    updateWorkUnit: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: ResolverContext
    ) => {
      await requireWorkUnitAccess(ctx, id);
      const unit = await prisma.workUnitEntity.update({
        where: { id },
        data: {
          name: input.name as string | undefined,
          address: input.address as string | undefined,
          isActive: input.isActive as boolean | undefined,
        },
        include: { professionals: true },
      });
      return { ...unit, professionalCount: unit.professionals.length };
    },

    // Settings mutations
    createOrganization: async (
      _: unknown,
      { input }: { input: { name: string; documentId: string; documentType: string } }
    ) => {
      return prisma.whatsappBusinessOrganization.create({
        data: {
          name: input.name,
          documentId: input.documentId,
          documentType: input.documentType,
          status: "ACTIVE",
        },
      });
    },

    updateOrganization: async (
      _: unknown,
      { id, input }: { id: string; input: { name?: string; documentId?: string } }
    ) => {
      return prisma.whatsappBusinessOrganization.update({
        where: { id },
        data: {
          ...(input.name && { name: input.name }),
          ...(input.documentId && { documentId: input.documentId }),
        },
        include: { accounts: { include: { agent: true } } },
      });
    },

    createWhatsappAccount: async (
      _: unknown,
      { input }: {
        input: {
          accountName: string;
          displayPhoneNumber: string;
          businessPhoneNumberId: string;
          wabaId: string;
          accessToken: string;
          organizationId: string;
        }
      }
    ) => {
      // Verify connection with Meta API before saving
      let status = "CONNECTED";
      try {
        const res = await fetch(
          `https://graph.facebook.com/v20.0/${input.businessPhoneNumberId}`,
          { headers: { Authorization: `Bearer ${input.accessToken}` } }
        );
        if (!res.ok) status = "ERROR";
      } catch {
        status = "ERROR";
      }

      const account = await prisma.whatsappProviderConfig.create({
        data: {
          accountName: input.accountName,
          displayPhoneNumber: input.displayPhoneNumber,
          businessPhoneNumberId: input.businessPhoneNumberId,
          wabaId: input.wabaId,
          accessToken: input.accessToken,
          status,
          organizationId: input.organizationId,
        },
        include: { agent: true },
      });

      // Auto-create an AI agent for this account
      if (status === "CONNECTED") {
        await prisma.agent.create({
          data: {
            displayName: "Agente IA",
            kind: "AI",
            status: "ACTIVE",
            whatsappProviderConfigId: account.id,
            aiProvider: "ANTHROPIC",
            aiModel: "claude-sonnet-4-6",
            systemPrompt:
              "Você é um assistente de vendas especializado. Qualifique leads e escale para humanos quando necessário.",
          },
        });
      }

      return account;
    },

    deleteWhatsappAccount: async (_: unknown, { id }: { id: string }) => {
      await prisma.whatsappProviderConfig.delete({ where: { id } });
      return true;
    },

    updateAgent: async (
      _: unknown,
      { id, input }: {
        id: string;
        input: {
          displayName?: string;
          status?: string;
          aiProvider?: string;
          aiModel?: string;
          systemPrompt?: string;
          escalationThreshold?: number;
        }
      }
    ) => {
      return prisma.agent.update({
        where: { id },
        data: {
          ...(input.displayName && { displayName: input.displayName }),
          ...(input.status && { status: input.status }),
          ...(input.aiProvider && { aiProvider: input.aiProvider }),
          ...(input.aiModel && { aiModel: input.aiModel }),
          ...(input.systemPrompt !== undefined && { systemPrompt: input.systemPrompt }),
          ...(input.escalationThreshold !== undefined && { escalationThreshold: input.escalationThreshold }),
        },
      });
    },

    testWhatsappConnection: async (_: unknown, { accountId }: { accountId: string }) => {
      const account = await prisma.whatsappProviderConfig.findUnique({
        where: { id: accountId },
      });
      if (!account) {
        return { success: false, message: "Conta não encontrada", phoneNumber: null };
      }

      try {
        const res = await fetch(
          `https://graph.facebook.com/v20.0/${account.businessPhoneNumberId}`,
          { headers: { Authorization: `Bearer ${account.accessToken}` } }
        );
        const data = await res.json() as { display_phone_number?: string; error?: { message: string } };

        if (res.ok) {
          await prisma.whatsappProviderConfig.update({
            where: { id: accountId },
            data: { status: "CONNECTED" },
          });
          return {
            success: true,
            message: "Conexão bem-sucedida!",
            phoneNumber: data.display_phone_number ?? account.displayPhoneNumber,
          };
        } else {
          await prisma.whatsappProviderConfig.update({
            where: { id: accountId },
            data: { status: "ERROR" },
          });
          return {
            success: false,
            message: data.error?.message ?? "Erro de autenticação",
            phoneNumber: null,
          };
        }
      } catch {
        return { success: false, message: "Erro ao conectar com a API", phoneNumber: null };
      }
    },

    updateKanbanColumn: async (
      _: unknown,
      { id, input }: { id: string; input: { name?: string; color?: string } }
    ) => {
      const col = await prisma.kanbanColumn.update({
        where: { id },
        data: {
          ...(input.name && { name: input.name }),
          ...(input.color && { color: input.color }),
        },
      });
      // Return with required KanbanColumn shape
      return {
        ...col,
        totalLeadsCount: 0,
        hasMoreLeads: false,
        nextCursor: null,
        leads: [],
      };
    },

    changePassword: async (
      _: unknown,
      {
        currentPassword,
        newPassword,
      }: { currentPassword: string; newPassword: string },
      context: { userId?: string }
    ) => {
      if (!context.userId) throw new Error("Não autenticado");

      const user = await prisma.user.findUnique({ where: { id: context.userId } });
      if (!user?.password) throw new Error("Usuário não encontrado");

      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) throw new Error("Senha atual incorreta");

      const hashed = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { id: context.userId },
        data: { password: hashed },
      });

      return true;
    },
  },
};
