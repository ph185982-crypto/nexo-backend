export const typeDefs = `#graphql
  scalar DateTime
  scalar JSON

  # ─── Enums ────────────────────────────────────────────
  enum LeadOrigin { INBOUND OUTBOUND }
  enum LeadStatus { OPEN ESCALATED CLOSED BLOCKED }
  enum KanbanColumnType { CUSTOM ESCALATED LOST TRIAGE JUNK }
  enum CampaignStatus { PLANNING ACTIVE PAUSED COMPLETED CANCELLED }
  enum CampaignMode { DEFAULT PARALLEL }
  enum MessageRole { ASSISTANT USER }
  enum MessageType { TEXT IMAGE AUDIO VIDEO DOCUMENT }
  enum CalendarEventStatus { SCHEDULED COMPLETED CANCELLED }
  enum AgentKind { AI HUMAN }

  # ─── Organization ─────────────────────────────────────
  type WhatsappBusinessOrganization {
    id: ID!
    name: String!
    documentId: String!
    documentType: String!
    status: String!
    accounts: [WhatsappProviderConfig!]
    createdAt: DateTime!
  }

  type WhatsappProviderConfig {
    id: ID!
    accountName: String!
    displayPhoneNumber: String!
    businessPhoneNumberId: String!
    status: String!
    organizationId: String!
    agent: Agent
    health: ProviderHealth
    createdAt: DateTime!
  }

  type ProviderHealth {
    status: String!
    lastCheckedAt: DateTime
    message: String
  }

  type Agent {
    id: ID!
    displayName: String!
    kind: AgentKind!
    status: String!
    whatsappProviderConfigId: String!
    systemPrompt: String
    aiProvider: String
    aiModel: String
    escalationThreshold: Int!
    sandboxMode: Boolean!
    createdAt: DateTime!
  }

  # ─── Kanban ───────────────────────────────────────────
  type KanbanColumn {
    id: ID!
    name: String!
    order: Int!
    type: KanbanColumnType!
    color: String!
    isDefaultEntry: Boolean!
    totalLeadsCount: Int!
    hasMoreLeads: Boolean!
    nextCursor: String
    leads: [Lead!]!
  }

  type KanbanBoard {
    columns: [KanbanColumn!]!
  }

  # ─── Leads ────────────────────────────────────────────
  type Lead {
    id: ID!
    phoneNumber: String!
    profileName: String
    email: String
    cpf: String
    location: String
    leadOrigin: LeadOrigin!
    status: LeadStatus!
    organizationId: String!
    kanbanColumnId: String!
    kanbanColumn: KanbanColumnInfo
    tags: [Tag!]
    activities: [LeadActivity!]
    escalations: [LeadEscalation!]
    createdAt: DateTime!
    lastActivityAt: DateTime
  }

  type KanbanColumnInfo {
    id: ID!
    name: String!
    color: String!
    type: KanbanColumnType!
  }

  type Tag {
    id: ID!
    name: String!
    color: String!
    kind: String!
  }

  type LeadActivity {
    id: ID!
    leadId: String!
    type: String!
    description: String!
    createdBy: String
    createdAt: DateTime!
  }

  type LeadEscalation {
    id: ID!
    leadId: String!
    reason: String
    escalatedTo: String
    status: String!
    createdAt: DateTime!
    resolvedAt: DateTime
  }

  # ─── Conversations ────────────────────────────────────
  type WhatsappConversation {
    id: ID!
    customerWhatsappBusinessId: String!
    profileName: String
    leadOrigin: LeadOrigin!
    leadId: String!
    lead: Lead
    whatsappProviderConfigId: String!
    provider: WhatsappProviderConfig
    tags: [Tag!]
    lastMessage: WhatsappMessage
    lastMessageAt: DateTime
    isActive: Boolean!
    unreadCount: Int
    createdAt: DateTime!
  }

  type WhatsappMessage {
    id: ID!
    content: String!
    type: MessageType!
    role: MessageRole!
    sentAt: DateTime!
    mediaUrl: String
    caption: String
    repliedToId: String
    status: String!
    conversationId: String!
  }

  type ConversationsPaginated {
    conversations: [WhatsappConversation!]!
    hasMore: Boolean!
    nextCursor: String
    total: Int!
  }

  type MessagesPaginated {
    messages: [WhatsappMessage!]!
    hasMore: Boolean!
    nextCursor: String
  }

  # ─── Dashboard ────────────────────────────────────────
  type WidgetsData {
    uniqueWhatsappConversations: Int!
    leadsQuentes: Int!
    conversationWindowsOpened: Int!
    repassados: Int!
    contactsSentDocs: Int!
    regionStatistics: [RegionStat!]
  }

  type RegionStat {
    region: String!
    count: Int!
  }

  # ─── Campaigns ────────────────────────────────────────
  type Campaign {
    id: ID!
    name: String!
    objective: String!
    status: CampaignStatus!
    mode: CampaignMode!
    triggerType: String!
    scheduledAt: DateTime
    templateMessage: String!
    templateName: String
    phoneColumn: String
    identificationColumn: String
    variableMapping: JSON
    minDelaySeconds: Int!
    maxDelaySeconds: Int!
    maxMessagesPerMinute: Int!
    dailyStartTime: String!
    dailyEndTime: String!
    skipExistingConversation: Boolean!
    organizationId: String!
    senderId: String!
    sender: WhatsappProviderConfig
    totalRecipients: Int!
    sentCount: Int!
    failedCount: Int!
    repliedCount: Int!
    createdAt: DateTime!
  }

  type CampaignStats {
    totalRecipients: Int!
    sent: Int!
    failed: Int!
    replied: Int!
    successRate: Float!
    replyRate: Float!
  }

  type CampaignReplyRatePoint {
    date: String!
    sent: Int!
    replied: Int!
  }

  type CampaignRecipient {
    id: ID!
    campaignId: String!
    phoneNumber: String!
    name: String
    status: String!
    sentAt: DateTime
  }

  type CampaignRecipientsPaginated {
    recipients: [CampaignRecipient!]!
    total: Int!
    page: Int!
    pageSize: Int!
  }

  type CampaignsPaginated {
    campaigns: [Campaign!]!
    total: Int!
  }

  # ─── Calendar ─────────────────────────────────────────
  type CalendarEvent {
    id: ID!
    title: String!
    description: String
    location: String
    startTime: DateTime!
    endTime: DateTime!
    timezone: String!
    isAllDay: Boolean!
    status: CalendarEventStatus!
    provider: String!
    googleMeetLink: String
    workUnitId: String
    profissionalId: String
    leadId: String
    attendees: [CalendarAttendee!]
    createdAt: DateTime!
  }

  type CalendarAttendee {
    id: ID!
    name: String!
    email: String
    phone: String
    status: String!
  }

  type CalendarKpis {
    scheduledToday: Int!
    scheduledWeek: Int!
    completed: Int!
    cancelled: Int!
    pending: Int!
  }

  # ─── Professionals & Work Units ───────────────────────
  type ProfissionalEntity {
    id: ID!
    name: String!
    description: String
    workField: String
    imageUrl: String
    isActive: Boolean!
    loginEmail: String
    organizationId: String!
    availabilities: [ProfissionalAvailability!]
    workUnitCount: Int!
  }

  type ProfissionalAvailability {
    id: ID!
    profissionalId: String!
    dayOfWeek: Int!
    startTime: String!
    endTime: String!
    breakMinutes: Int!
    isActive: Boolean!
  }

  type WorkUnitEntity {
    id: ID!
    name: String!
    address: String
    timezone: String!
    isActive: Boolean!
    organizationId: String!
    professionalCount: Int!
  }

  # ─── Hierarchy ────────────────────────────────────────
  type OrgHierarchyItem {
    id: ID!
    parentId: String
    type: String!
    name: String!
    description: String
    agentId: String
    agent: Agent
    children: [OrgHierarchyItem!]
    order: Int!
  }

  # ─── Inputs ───────────────────────────────────────────
  input OrganizationFilter {
    search: String
    status: String
  }

  input ConversationFilter {
    leadStatus: String
    leadOrigin: LeadOrigin
    periodDays: Int
  }

  input KanbanFilter {
    leadStatus: String
    leadOrigin: LeadOrigin
    periodDays: Int
  }

  input CreateLeadInput {
    phoneNumber: String!
    profileName: String
    email: String
    leadOrigin: LeadOrigin!
    organizationId: String!
    kanbanColumnId: String!
    tagIds: [String!]
  }

  input UpdateLeadInput {
    phoneNumber: String
    profileName: String
    email: String
    leadOrigin: LeadOrigin
  }

  input CreateCampaignInput {
    name: String!
    objective: String!
    mode: CampaignMode!
    triggerType: String!
    scheduledAt: DateTime
    templateMessage: String!
    phoneColumn: String
    identificationColumn: String
    variableMapping: JSON
    minDelaySeconds: Int
    maxDelaySeconds: Int
    maxMessagesPerMinute: Int
    dailyStartTime: String
    dailyEndTime: String
    skipExistingConversation: Boolean
    organizationId: String!
    senderId: String!
    recipients: [RecipientInput!]!
  }

  input RecipientInput {
    phoneNumber: String!
    name: String
    metadata: JSON
  }

  input CreateCalendarEventInput {
    title: String!
    description: String
    location: String
    startTime: DateTime!
    endTime: DateTime!
    timezone: String
    isAllDay: Boolean
    organizationId: String!
    workUnitId: String
    profissionalId: String
    leadId: String
    whatsappProviderConfigId: String
    saveToGoogle: Boolean
    generateMeet: Boolean
    sendWhatsappNotification: Boolean
  }

  input CreateProfissionalInput {
    name: String!
    description: String
    workField: String
    isActive: Boolean
    loginEmail: String
    organizationId: String!
    workUnitIds: [String!]
    availabilities: [AvailabilityInput!]
  }

  input AvailabilityInput {
    dayOfWeek: Int!
    startTime: String!
    endTime: String!
    breakMinutes: Int
  }

  input CreateWorkUnitInput {
    name: String!
    address: String
    timezone: String
    organizationId: String!
  }

  input CreateOrganizationInput {
    name: String!
    documentId: String!
    documentType: String!
  }

  input UpdateOrganizationInput {
    name: String
    documentId: String
  }

  input CreateWhatsappAccountInput {
    accountName: String!
    displayPhoneNumber: String!
    businessPhoneNumberId: String!
    wabaId: String!
    accessToken: String!
    organizationId: String!
  }

  input UpdateAgentInput {
    displayName: String
    status: String
    aiProvider: String
    aiModel: String
    systemPrompt: String
    escalationThreshold: Int
    sandboxMode: Boolean
  }


  input UpdateKanbanColumnInput {
    name: String
    color: String
  }

  type TestConnectionResult {
    success: Boolean!
    message: String!
    phoneNumber: String
  }

  # ─── Queries ──────────────────────────────────────────
  type Query {
    # Dashboard
    widgetsData(timeFilter: String, whatsappProviderConfigId: String): WidgetsData!

    # Organization
    whatsappBusinessOrganizations(input: OrganizationFilter): [WhatsappBusinessOrganization!]!
    whatsappAccounts(organizationId: String!): [WhatsappProviderConfig!]!
    hierarchyItems(organizationId: String!): [OrgHierarchyItem!]!

    # Kanban
    getKanbanBoard(
      organizationId: String!
      leadsPerColumn: Int
      cursor: String
      filters: KanbanFilter
    ): KanbanBoard!

    # Conversations
    getConversationsByWhatsappAccount(
      accountId: String!
      cursor: String
      filters: ConversationFilter
    ): ConversationsPaginated!
    getConversationMessages(
      conversationId: String!
      cursor: String
    ): MessagesPaginated!

    # Campaigns
    getCampaigns(
      organizationId: String!
      status: String
      search: String
      periodDays: Int
    ): CampaignsPaginated!
    getCampaign(id: String!): Campaign
    getCampaignStats(id: String!): CampaignStats
    campaignReplyRate(id: String!, timeFilter: String): [CampaignReplyRatePoint!]!
    getCampaignRecipientsTable(
      id: String!
      page: Int
      pageSize: Int
    ): CampaignRecipientsPaginated!
    checkWhatsappProviderConfigHealth(id: String!): ProviderHealth!

    # Calendar
    listCalendarEvents(organizationId: String!, month: Int!, year: Int!): [CalendarEvent!]!
    getCalendarKpis(organizationId: String!): CalendarKpis!
    searchLeadsForScheduling(query: String!, organizationId: String!): [Lead!]!

    # Work Units & Professionals
    listWorkUnits(organizationId: String!, search: String): [WorkUnitEntity!]!
    listProfissionais(organizationId: String!, search: String): [ProfissionalEntity!]!
    getProfissional(id: String!): ProfissionalEntity

    # Lead Conversations
    getConversationsByLead(leadId: String!): [WhatsappConversation!]!
  }

  # ─── Mutations ────────────────────────────────────────
  type Mutation {
    # Leads
    createLead(input: CreateLeadInput!): Lead!
    updateLead(leadId: String!, input: UpdateLeadInput!): Lead!
    updateLeadKanbanColumn(leadId: String!, columnId: String!): Lead!
    updateLeadTags(leadId: String!, tagIds: [String!]!): Lead!
    blockLead(leadId: String!, reason: String): Lead!
    closeLead(leadId: String!): Lead!
    addLeadActivity(leadId: String!, type: String!, description: String!): LeadActivity!

    # Messages
    sendWhatsappMessage(conversationId: String!, content: String!): WhatsappMessage!

    # Campaigns
    createCampaign(input: CreateCampaignInput!): Campaign!
    startCampaign(id: String!): Campaign!
    pauseCampaign(id: String!): Campaign!
    cloneCampaign(id: String!): Campaign!

    # Calendar
    createCalendarEvent(input: CreateCalendarEventInput!): CalendarEvent!
    updateCalendarEvent(id: String!, input: CreateCalendarEventInput!): CalendarEvent!
    cancelCalendarEvent(id: String!): CalendarEvent!

    # Professionals
    createProfissional(input: CreateProfissionalInput!): ProfissionalEntity!
    updateProfissional(id: String!, input: CreateProfissionalInput!): ProfissionalEntity!

    # Work Units
    createWorkUnit(input: CreateWorkUnitInput!): WorkUnitEntity!
    updateWorkUnit(id: String!, input: CreateWorkUnitInput!): WorkUnitEntity!

    # Settings
    createOrganization(input: CreateOrganizationInput!): WhatsappBusinessOrganization!
    updateOrganization(id: String!, input: UpdateOrganizationInput!): WhatsappBusinessOrganization!
    createWhatsappAccount(input: CreateWhatsappAccountInput!): WhatsappProviderConfig!
    deleteWhatsappAccount(id: String!): Boolean!
    updateAgent(id: String!, input: UpdateAgentInput!): Agent!
    testWhatsappConnection(accountId: String!): TestConnectionResult!
    updateKanbanColumn(id: String!, input: UpdateKanbanColumnInput!): KanbanColumn!
    changePassword(currentPassword: String!, newPassword: String!): Boolean!
  }

  # ─── Subscriptions ────────────────────────────────────
  type Subscription {
    onNewMessage(conversationId: String!): WhatsappMessage!
    onConversationUpdate(accountId: String!): WhatsappConversation!
    onKanbanLeadMoved(organizationId: String!): Lead!
  }
`;
