-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "password" TEXT,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "WhatsappBusinessOrganization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tipo" TEXT NOT NULL DEFAULT 'VENDAS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappBusinessOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappProviderConfig" (
    "id" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "displayPhoneNumber" TEXT NOT NULL,
    "businessPhoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT,
    "accessToken" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sandboxMode" BOOLEAN NOT NULL DEFAULT false,
    "whatsappProviderConfigId" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "escalationThreshold" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentScriptVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "savedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentScriptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConfigVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "nivelVenda" TEXT NOT NULL DEFAULT 'medio',
    "usarEmoji" BOOLEAN NOT NULL DEFAULT true,
    "usarReticencias" BOOLEAN NOT NULL DEFAULT true,
    "escalationThreshold" INTEGER NOT NULL DEFAULT 3,
    "tomDeVoz" TEXT NOT NULL DEFAULT 'sincero',
    "arquetipoIA" TEXT,
    "objetivoVenda" TEXT NOT NULL DEFAULT 'fechar_venda',
    "nivelUrgencia" INTEGER NOT NULL DEFAULT 3,
    "matrizObjecoes" JSONB NOT NULL DEFAULT '[]',
    "restricoes" JSONB NOT NULL DEFAULT '[]',
    "followUpIntervalos" JSONB NOT NULL DEFAULT '[4,24,48,72]',
    "followUpMaxTentativas" INTEGER NOT NULL DEFAULT 4,
    "savedBy" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConfig" (
    "id" TEXT NOT NULL,
    "agentName" TEXT NOT NULL DEFAULT 'Pedro',
    "bastaoNumber" TEXT NOT NULL DEFAULT '5562984465388',
    "currentPrompt" TEXT NOT NULL DEFAULT '',
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "followUpHours" TEXT NOT NULL DEFAULT '4,24,48,72',
    "followUpPrompt" TEXT,
    "maxFollowUps" INTEGER NOT NULL DEFAULT 4,
    "deliveryWeekStart" INTEGER NOT NULL DEFAULT 9,
    "deliveryWeekEnd" INTEGER NOT NULL DEFAULT 18,
    "deliverySatStart" INTEGER NOT NULL DEFAULT 8,
    "deliverySatEnd" INTEGER NOT NULL DEFAULT 13,
    "deliveryArea" TEXT NOT NULL DEFAULT '',
    "escalationThreshold" INTEGER NOT NULL DEFAULT 3,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "autoPassagem" BOOLEAN NOT NULL DEFAULT true,
    "autoMedia" BOOLEAN NOT NULL DEFAULT true,
    "escalacaoAtiva" BOOLEAN NOT NULL DEFAULT true,
    "personalityProfileId" TEXT,
    "strategyProfileId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPromptHistory" (
    "id" TEXT NOT NULL,
    "agentConfigId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "savedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPromptHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KanbanColumn" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultEntry" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KanbanColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "profileName" TEXT,
    "email" TEXT,
    "cpf" TEXT,
    "location" TEXT,
    "leadOrigin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "organizationId" TEXT NOT NULL,
    "kanbanColumnId" TEXT NOT NULL,
    "prospectLeadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3),
    "ctwaClid" TEXT,
    "adSourceId" TEXT,
    "adHeadline" TEXT,
    "adSourceUrl" TEXT,
    "adReferralAt" TIMESTAMP(3),
    "valorContrato" DOUBLE PRECISION,
    "empresa" TEXT,
    "segmento" TEXT,
    "faturamentoMensal" DOUBLE PRECISION,
    "lojaFisica" TEXT,
    "cnpjStatus" TEXT,
    "dorPrincipal" TEXT,
    "icpStatus" TEXT,
    "scoreSdr" INTEGER,
    "reuniaoEm" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaConversionEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "httpStatus" INTEGER,
    "resposta" TEXT,
    "payload" JSONB,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaConversionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDiagnosis" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "comercialData" JSONB NOT NULL DEFAULT '{}',
    "produtoData" JSONB NOT NULL DEFAULT '{}',
    "marketingData" JSONB NOT NULL DEFAULT '{}',
    "operacaoData" JSONB NOT NULL DEFAULT '{}',
    "financeiroData" JSONB NOT NULL DEFAULT '{}',
    "priorizacaoData" JSONB NOT NULL DEFAULT '[]',
    "isFinalized" BOOLEAN NOT NULL DEFAULT false,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryCard" (
    "id" TEXT NOT NULL,
    "diagnosisId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "pilar" TEXT NOT NULL DEFAULT 'COMERCIAL',
    "dataAlvo" TIMESTAMP(3),
    "responsavel" TEXT NOT NULL DEFAULT 'PEDRO',
    "column" TEXT NOT NULL DEFAULT 'BACKLOG',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEscalation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "reason" TEXT,
    "escalatedTo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LeadEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadTag" (
    "leadId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "LeadTag_pkey" PRIMARY KEY ("leadId","tagId")
);

-- CreateTable
CREATE TABLE "WhatsappConversation" (
    "id" TEXT NOT NULL,
    "customerWhatsappBusinessId" TEXT NOT NULL,
    "profileName" TEXT,
    "leadOrigin" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "whatsappProviderConfigId" TEXT NOT NULL,
    "conversationRatings" JSONB NOT NULL DEFAULT '[]',
    "lastMessageAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "humanTakeover" BOOLEAN NOT NULL DEFAULT false,
    "etapa" TEXT NOT NULL DEFAULT 'NOVO',
    "produtoInteresse" TEXT,
    "midiaEnviada" BOOLEAN NOT NULL DEFAULT false,
    "localizacaoRecebida" BOOLEAN NOT NULL DEFAULT false,
    "foraAreaEntrega" BOOLEAN NOT NULL DEFAULT false,
    "resumoEnviado" BOOLEAN NOT NULL DEFAULT false,
    "cortesiasAposConf" INTEGER NOT NULL DEFAULT 0,
    "localizacaoTexto" TEXT,
    "nomeRecebedor" TEXT,
    "horarioEntrega" TEXT,
    "formaPagamento" TEXT,
    "sessaoNacional" JSONB,
    "sessaoProspeccao" JSONB,
    "midiasEnviadas" JSONB DEFAULT '[]',
    "aiLockUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationFollowUp" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "leadName" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "accessToken" TEXT,
    "aiMessageAt" TIMESTAMP(3) NOT NULL,
    "nextSendAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTag" (
    "conversationId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ConversationTag_pkey" PRIMARY KEY ("conversationId","tagId")
);

-- CreateTable
CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "wamid" TEXT,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "mediaUrl" TEXT,
    "caption" TEXT,
    "repliedToId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "aiProcessedAt" TIMESTAMP(3),
    "conversationId" TEXT NOT NULL,

    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "mode" TEXT NOT NULL DEFAULT 'DEFAULT',
    "triggerType" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "templateMessage" TEXT NOT NULL,
    "templateName" TEXT,
    "phoneColumn" TEXT,
    "identificationColumn" TEXT,
    "variableMapping" JSONB,
    "minDelaySeconds" INTEGER NOT NULL DEFAULT 15,
    "maxDelaySeconds" INTEGER NOT NULL DEFAULT 45,
    "maxMessagesPerMinute" INTEGER NOT NULL DEFAULT 5,
    "dailyStartTime" TEXT NOT NULL DEFAULT '08:00',
    "dailyEndTime" TEXT NOT NULL DEFAULT '20:00',
    "maxConsecutiveDays" INTEGER NOT NULL DEFAULT 7,
    "skipExistingConversation" BOOLEAN NOT NULL DEFAULT true,
    "useAiOptimization" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "provider" TEXT NOT NULL DEFAULT 'LOCAL',
    "externalEventId" TEXT,
    "googleMeetLink" TEXT,
    "organizationId" TEXT NOT NULL,
    "workUnitId" TEXT,
    "profissionalId" TEXT,
    "whatsappProviderConfigId" TEXT,
    "leadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarAttendee" (
    "id" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INVITED',

    CONSTRAINT "CalendarAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarReminder" (
    "id" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "minutesBefore" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CalendarReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfissionalEntity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "workField" TEXT,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "loginEmail" TEXT,
    "isCalendarOffline" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ProfissionalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfissionalAvailability" (
    "id" TEXT NOT NULL,
    "profissionalId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProfissionalAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkUnitEntity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "WorkUnitEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfissionalWorkProfile" (
    "id" TEXT NOT NULL,
    "profissionalId" TEXT NOT NULL,
    "workUnitId" TEXT NOT NULL,
    "role" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProfissionalWorkProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgHierarchyItem" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "agentId" TEXT,
    "organizationId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgHierarchyItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerNotification" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "especificacoes" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "priceInstallments" DOUBLE PRECISION,
    "installments" INTEGER NOT NULL DEFAULT 10,
    "imageUrl" TEXT,
    "imageUrls" TEXT[],
    "videoUrl" TEXT,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "usarEmoji" BOOLEAN NOT NULL DEFAULT true,
    "usarReticencias" BOOLEAN NOT NULL DEFAULT true,
    "nivelVenda" TEXT NOT NULL DEFAULT 'medio',
    "tomDeVoz" TEXT NOT NULL DEFAULT 'sincero',
    "arquetipoIA" TEXT,
    "objetivoVenda" TEXT NOT NULL DEFAULT 'fechar_venda',
    "nivelUrgencia" INTEGER NOT NULL DEFAULT 3,
    "matrizObjecoes" JSONB NOT NULL DEFAULT '[]',
    "restricoes" JSONB NOT NULL DEFAULT '[]',
    "followUpIntervalos" JSONB NOT NULL DEFAULT '[4,24,48,72]',
    "followUpMaxTentativas" INTEGER NOT NULL DEFAULT 4,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionLog" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookQueue" (
    "id" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userId" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalityProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "archetype" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '👤',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalityProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "salesGoal" TEXT NOT NULL,
    "urgency" TEXT NOT NULL DEFAULT 'medium',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectionRule" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "objectionType" TEXT NOT NULL,
    "responseStrategy" TEXT NOT NULL,
    "counterArgument" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstraintRule" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "reason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConstraintRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "precoCusto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "precoVenda" DOUBLE PRECISION NOT NULL,
    "precoDesconto" DOUBLE PRECISION NOT NULL,
    "parcelamento" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fotoUrl" TEXT,
    "descricao" TEXT,
    "categoria" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ehFerramenta" BOOLEAN NOT NULL DEFAULT true,
    "importadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "ultimaOfertaEm" TIMESTAMP(3),
    "vezesUsadoEmOferta" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoNacional" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "telefoneCliente" TEXT NOT NULL,
    "nomeCliente" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "cepDestino" TEXT NOT NULL,
    "enderecoCompleto" TEXT NOT NULL,
    "valorProduto" DOUBLE PRECISION NOT NULL,
    "valorFrete" DOUBLE PRECISION NOT NULL,
    "valorTotal" DOUBLE PRECISION NOT NULL,
    "transportadora" TEXT NOT NULL,
    "prazoFrete" INTEGER NOT NULL,
    "servicoFreteId" TEXT NOT NULL,
    "formaPagamento" TEXT NOT NULL,
    "pagamentoId" TEXT,
    "pagamentoStatus" TEXT NOT NULL DEFAULT 'PENDENTE',
    "pagamentoConfirmado" BOOLEAN NOT NULL DEFAULT false,
    "pagamentoConfirmadoEm" TIMESTAMP(3),
    "cartItemId" TEXT,
    "urlEtiqueta" TEXT,
    "codigoRastreamento" TEXT,
    "etapaEnvio" TEXT NOT NULL DEFAULT 'AGUARDANDO_PAGAMENTO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PedidoNacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CotacaoFrete" (
    "id" TEXT NOT NULL,
    "telefoneCliente" TEXT NOT NULL,
    "cepDestino" TEXT NOT NULL,
    "cotacoes" JSONB NOT NULL,
    "expiradoEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CotacaoFrete_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personType" TEXT NOT NULL,
    "cpfCnpj" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT,
    "name" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditLimit" DOUBLE PRECISION,
    "closingDay" INTEGER,
    "dueDay" INTEGER,
    "color" TEXT,
    "icon" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT,
    "accountId" TEXT,
    "categoryId" TEXT,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "competencia" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "proofMediaId" TEXT,
    "proofMediaUrl" TEXT,
    "recurringBillId" TEXT,
    "installmentPlanId" TEXT,
    "installmentNumber" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringBill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallmentPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT,
    "accountId" TEXT,
    "name" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "installmentValue" DOUBLE PRECISION NOT NULL,
    "competenciaStart" TEXT NOT NULL,
    "paidCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProofSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "extractedText" TEXT,
    "extractedData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pendingData" JSONB,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialProofSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkout" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "telefoneCliente" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "nomeCliente" TEXT,
    "cep" TEXT,
    "enderecoCompleto" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "produto" TEXT,
    "formaPagamento" TEXT,
    "pagamentoId" TEXT,
    "pagamentoTipo" TEXT,
    "pixCopiaECola" TEXT,
    "pixQrCodeBase64" TEXT,
    "linkParcelado" TEXT,
    "valorProduto" DOUBLE PRECISION NOT NULL DEFAULT 197,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiradoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Checkout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectSegment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "termoBusca" TEXT NOT NULL,
    "termosSecundarios" TEXT[],
    "cidades" TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "pesoSemSite" INTEGER NOT NULL DEFAULT 3,
    "pesoSemAnuncioAtivo" INTEGER NOT NULL DEFAULT 2,
    "pesoInstagramParado" INTEGER NOT NULL DEFAULT 1,
    "pesoRatingBaixo" INTEGER NOT NULL DEFAULT 1,
    "limiarScoreQualificado" INTEGER NOT NULL DEFAULT 4,
    "apenasCelular" BOOLEAN NOT NULL DEFAULT false,
    "filtroSite" TEXT NOT NULL DEFAULT 'TODOS',
    "metaEmpresas" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcingRun" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EXECUTANDO',
    "meta" INTEGER NOT NULL,
    "indice" INTEGER NOT NULL DEFAULT 0,
    "inseridos" INTEGER NOT NULL DEFAULT 0,
    "ignorados" INTEGER NOT NULL DEFAULT 0,
    "erros" INTEGER NOT NULL DEFAULT 0,
    "lotes" INTEGER NOT NULL DEFAULT 0,
    "motivo" TEXT,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "finalizadoEm" TIMESTAMP(3),

    CONSTRAINT "SourcingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectLead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "segmentId" TEXT,
    "nome" TEXT,
    "telefone" TEXT,
    "tipoTelefone" TEXT,
    "enderecoCompleto" TEXT,
    "website" TEXT,
    "placeId" TEXT,
    "temSite" BOOLEAN,
    "temAnuncioAtivo" BOOLEAN,
    "instagramAtivo" BOOLEAN,
    "ultimaPostagemIG" TIMESTAMP(3),
    "followersIG" INTEGER,
    "ratingGoogle" DOUBLE PRECISION,
    "numeroAvaliacoes" INTEGER,
    "score" INTEGER,
    "analiseIA" TEXT,
    "motivoAnaliseIA" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOVO',
    "templateUsadoId" TEXT,
    "dataAbordagem" TIMESTAMP(3),
    "tentativasDisparo" INTEGER NOT NULL DEFAULT 0,
    "tipoNegocio" TEXT,
    "urgencia" TEXT,
    "sinalOportunidade" TEXT,
    "notas" TEXT,
    "dataHoraReuniao" TIMESTAMP(3),
    "googleCalendarEventId" TEXT,
    "googleMeetLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateProspeccao" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nomeTemplateMeta" TEXT NOT NULL,
    "idioma" TEXT NOT NULL DEFAULT 'pt_BR',
    "variaveis" TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "corpoTexto" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateProspeccao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisparoConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "limiteDiarioAtual" INTEGER NOT NULL DEFAULT 15,
    "incrementoSemanal" INTEGER NOT NULL DEFAULT 10,
    "limiteMaximoDiario" INTEGER NOT NULL DEFAULT 100,
    "janelaInicioHora" INTEGER NOT NULL DEFAULT 9,
    "janelaFimHora" INTEGER NOT NULL DEFAULT 18,
    "diasSemana" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "pausadoManualmente" BOOLEAN NOT NULL DEFAULT false,
    "motivoPausa" TEXT,
    "ultimaAtualizacaoLimite" TIMESTAMP(3),
    "diasEntreTentativas" INTEGER NOT NULL DEFAULT 3,
    "maxTentativasContato" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisparoConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisparoJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisparoJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisparoEnvio" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "templateId" TEXT,
    "wamid" TEXT,
    "tentativa" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entregueEm" TIMESTAMP(3),
    "lidoEm" TIMESTAMP(3),
    "falhouEm" TIMESTAMP(3),
    "erroCodigo" INTEGER,
    "erroMensagem" TEXT,

    CONSTRAINT "DisparoEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email" TEXT,
    "refreshToken" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "criadoPorId" TEXT,
    "ultimoUsoEm" TIMESTAMP(3),
    "revogadaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfertaGerada" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "nomeProduto" TEXT NOT NULL,
    "precoCusto" DOUBLE PRECISION NOT NULL,
    "precoVenda" DOUBLE PRECISION NOT NULL,
    "precoDesconto" DOUBLE PRECISION NOT NULL,
    "parcelamento" DOUBLE PRECISION NOT NULL,
    "fotoOriginalUrl" TEXT,
    "artePath" TEXT,
    "textoOferta" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PRONTA',
    "enviadaParaWhatsApp" BOOLEAN NOT NULL DEFAULT false,
    "enviadaEm" TIMESTAMP(3),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfertaGerada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_transacoes" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "descricao" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "tipo_negocio" TEXT NOT NULL DEFAULT 'pessoal',
    "empresa" TEXT,
    "data_transacao" DATE NOT NULL,
    "mes" TEXT NOT NULL,
    "confirmado" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_transacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_conversas" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_conversas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_contexto_pedro" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "categoria" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_contexto_pedro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_lembretes" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "data_hora" TIMESTAMP(3) NOT NULL,
    "recorrente" BOOLEAN NOT NULL DEFAULT false,
    "frequencia" TEXT,
    "enviado" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_lembretes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_dividas" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor_total" DOUBLE PRECISION NOT NULL,
    "valor_pago" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "parcela_mensal" DOUBLE PRECISION,
    "dia_vencimento" INTEGER,
    "credor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ativa',
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_dividas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_metas_financeiras" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor_alvo" DOUBLE PRECISION NOT NULL,
    "valor_atual" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tipo" TEXT NOT NULL DEFAULT 'mensal',
    "tipo_negocio" TEXT,
    "data_inicio" DATE,
    "data_fim" DATE,
    "status" TEXT NOT NULL DEFAULT 'ativa',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_metas_financeiras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_receitas_previstas" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "data_prevista" DATE NOT NULL,
    "tipo_negocio" TEXT,
    "cliente" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "data_recebimento" TIMESTAMP(3),
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "motivo_perda" TEXT,
    "data_perda" TIMESTAMP(3),
    "contrato_id" TEXT,
    "parcela_numero" INTEGER,
    "parcelas_total" INTEGER,

    CONSTRAINT "max_receitas_previstas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_contratos_receita" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "cliente" TEXT,
    "tipo_negocio" TEXT NOT NULL DEFAULT 'nexo',
    "modo" TEXT NOT NULL DEFAULT 'recorrente',
    "valor_parcela" DOUBLE PRECISION NOT NULL,
    "valor_total" DOUBLE PRECISION,
    "duracao_meses" INTEGER,
    "dia_vencimento" INTEGER NOT NULL,
    "data_inicio" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "gerado_ate" DATE,
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_contratos_receita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_historico_financeiro" (
    "id" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidade_id" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_historico_financeiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_tarefas" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "recorrente" BOOLEAN NOT NULL DEFAULT false,
    "frequencia" TEXT,
    "proxima_cobranca" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ativa',
    "historico" JSONB NOT NULL DEFAULT '[]',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_tarefas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_alertas_enviados" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "enviado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_alertas_enviados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_contas_pagar" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "data_vencimento" DATE NOT NULL,
    "categoria" TEXT NOT NULL DEFAULT 'Outros',
    "tipo_negocio" TEXT NOT NULL DEFAULT 'pessoal',
    "recorrente" BOOLEAN NOT NULL DEFAULT false,
    "frequencia" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "transacao_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_contas_pagar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_orcamentos" (
    "id" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "limite_mensal" DOUBLE PRECISION NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_orcamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_webhook_events" (
    "id" TEXT NOT NULL,
    "from_number" TEXT,
    "msg_type" TEXT,
    "msg_id" TEXT,
    "payload" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_whatsappProviderConfigId_key" ON "Agent"("whatsappProviderConfigId");

-- CreateIndex
CREATE INDEX "AgentScriptVersion_agentId_createdAt_idx" ON "AgentScriptVersion"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentConfigVersion_agentId_createdAt_idx" ON "AgentConfigVersion"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentPromptHistory_agentConfigId_createdAt_idx" ON "AgentPromptHistory"("agentConfigId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_adSourceId_idx" ON "Lead"("adSourceId");

-- CreateIndex
CREATE INDEX "Lead_ctwaClid_idx" ON "Lead"("ctwaClid");

-- CreateIndex
CREATE INDEX "MetaConversionEvent_status_createdAt_idx" ON "MetaConversionEvent"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetaConversionEvent_leadId_eventName_key" ON "MetaConversionEvent"("leadId", "eventName");

-- CreateIndex
CREATE UNIQUE INDEX "ClientDiagnosis_leadId_key" ON "ClientDiagnosis"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationFollowUp_conversationId_key" ON "ConversationFollowUp"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMessage_wamid_key" ON "WhatsappMessage"("wamid");

-- CreateIndex
CREATE UNIQUE INDEX "ProfissionalWorkProfile_profissionalId_workUnitId_key" ON "ProfissionalWorkProfile"("profissionalId", "workUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgHierarchyItem_agentId_key" ON "OrgHierarchyItem"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AiConfig_organizationId_key" ON "AiConfig"("organizationId");

-- CreateIndex
CREATE INDEX "DecisionLog_conversationId_createdAt_idx" ON "DecisionLog"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadNote_leadId_createdAt_idx" ON "LeadNote"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_slug_key" ON "Produto"("slug");

-- CreateIndex
CREATE INDEX "FinancialProfile_organizationId_idx" ON "FinancialProfile"("organizationId");

-- CreateIndex
CREATE INDEX "FinancialAccount_organizationId_idx" ON "FinancialAccount"("organizationId");

-- CreateIndex
CREATE INDEX "FinancialCategory_organizationId_idx" ON "FinancialCategory"("organizationId");

-- CreateIndex
CREATE INDEX "FinancialTransaction_organizationId_createdAt_idx" ON "FinancialTransaction"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialTransaction_organizationId_status_idx" ON "FinancialTransaction"("organizationId", "status");

-- CreateIndex
CREATE INDEX "FinancialTransaction_organizationId_type_idx" ON "FinancialTransaction"("organizationId", "type");

-- CreateIndex
CREATE INDEX "RecurringBill_organizationId_idx" ON "RecurringBill"("organizationId");

-- CreateIndex
CREATE INDEX "InstallmentPlan_organizationId_idx" ON "InstallmentPlan"("organizationId");

-- CreateIndex
CREATE INDEX "FinancialProofSession_organizationId_phoneNumber_idx" ON "FinancialProofSession"("organizationId", "phoneNumber");

-- CreateIndex
CREATE INDEX "FinancialProofSession_phoneNumber_status_idx" ON "FinancialProofSession"("phoneNumber", "status");

-- CreateIndex
CREATE INDEX "Checkout_conversationId_idx" ON "Checkout"("conversationId");

-- CreateIndex
CREATE INDEX "Checkout_telefoneCliente_idx" ON "Checkout"("telefoneCliente");

-- CreateIndex
CREATE INDEX "ProspectSegment_organizationId_ativo_idx" ON "ProspectSegment"("organizationId", "ativo");

-- CreateIndex
CREATE INDEX "SourcingRun_segmentId_status_idx" ON "SourcingRun"("segmentId", "status");

-- CreateIndex
CREATE INDEX "SourcingRun_status_atualizadoEm_idx" ON "SourcingRun"("status", "atualizadoEm");

-- CreateIndex
CREATE INDEX "ProspectLead_organizationId_status_idx" ON "ProspectLead"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ProspectLead_segmentId_status_idx" ON "ProspectLead"("segmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectLead_placeId_key" ON "ProspectLead"("placeId");

-- CreateIndex
CREATE INDEX "TemplateProspeccao_organizationId_ativo_idx" ON "TemplateProspeccao"("organizationId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "DisparoConfig_organizationId_key" ON "DisparoConfig"("organizationId");

-- CreateIndex
CREATE INDEX "DisparoJob_organizationId_status_idx" ON "DisparoJob"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DisparoJob_leadId_status_idx" ON "DisparoJob"("leadId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DisparoEnvio_wamid_key" ON "DisparoEnvio"("wamid");

-- CreateIndex
CREATE INDEX "DisparoEnvio_organizationId_enviadoEm_idx" ON "DisparoEnvio"("organizationId", "enviadoEm");

-- CreateIndex
CREATE INDEX "DisparoEnvio_leadId_idx" ON "DisparoEnvio"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_provider_key" ON "IntegrationCredential"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");

-- CreateIndex
CREATE INDEX "ApiKey_revogadaEm_idx" ON "ApiKey"("revogadaEm");

-- CreateIndex
CREATE INDEX "OfertaGerada_produtoId_criadaEm_idx" ON "OfertaGerada"("produtoId", "criadaEm");

-- CreateIndex
CREATE INDEX "max_transacoes_data_transacao_idx" ON "max_transacoes"("data_transacao");

-- CreateIndex
CREATE INDEX "max_transacoes_categoria_idx" ON "max_transacoes"("categoria");

-- CreateIndex
CREATE INDEX "max_transacoes_mes_idx" ON "max_transacoes"("mes");

-- CreateIndex
CREATE INDEX "max_conversas_numero_criado_em_idx" ON "max_conversas"("numero", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "max_contexto_pedro_chave_key" ON "max_contexto_pedro"("chave");

-- CreateIndex
CREATE INDEX "max_lembretes_enviado_data_hora_idx" ON "max_lembretes"("enviado", "data_hora");

-- CreateIndex
CREATE INDEX "max_receitas_previstas_data_prevista_idx" ON "max_receitas_previstas"("data_prevista");

-- CreateIndex
CREATE INDEX "max_receitas_previstas_contrato_id_idx" ON "max_receitas_previstas"("contrato_id");

-- CreateIndex
CREATE UNIQUE INDEX "max_receitas_previstas_contrato_id_parcela_numero_key" ON "max_receitas_previstas"("contrato_id", "parcela_numero");

-- CreateIndex
CREATE INDEX "max_historico_financeiro_entidade_entidade_id_idx" ON "max_historico_financeiro"("entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "max_historico_financeiro_criado_em_idx" ON "max_historico_financeiro"("criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "max_alertas_enviados_chave_key" ON "max_alertas_enviados"("chave");

-- CreateIndex
CREATE INDEX "max_contas_pagar_status_data_vencimento_idx" ON "max_contas_pagar"("status", "data_vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "max_orcamentos_categoria_key" ON "max_orcamentos"("categoria");

-- CreateIndex
CREATE INDEX "max_webhook_events_msg_id_idx" ON "max_webhook_events"("msg_id");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappProviderConfig" ADD CONSTRAINT "WhatsappProviderConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_whatsappProviderConfigId_fkey" FOREIGN KEY ("whatsappProviderConfigId") REFERENCES "WhatsappProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentScriptVersion" ADD CONSTRAINT "AgentScriptVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConfigVersion" ADD CONSTRAINT "AgentConfigVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConfig" ADD CONSTRAINT "AgentConfig_personalityProfileId_fkey" FOREIGN KEY ("personalityProfileId") REFERENCES "PersonalityProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConfig" ADD CONSTRAINT "AgentConfig_strategyProfileId_fkey" FOREIGN KEY ("strategyProfileId") REFERENCES "StrategyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPromptHistory" ADD CONSTRAINT "AgentPromptHistory_agentConfigId_fkey" FOREIGN KEY ("agentConfigId") REFERENCES "AgentConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_kanbanColumnId_fkey" FOREIGN KEY ("kanbanColumnId") REFERENCES "KanbanColumn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_prospectLeadId_fkey" FOREIGN KEY ("prospectLeadId") REFERENCES "ProspectLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDiagnosis" ADD CONSTRAINT "ClientDiagnosis_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCard" ADD CONSTRAINT "DeliveryCard_diagnosisId_fkey" FOREIGN KEY ("diagnosisId") REFERENCES "ClientDiagnosis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEscalation" ADD CONSTRAINT "LeadEscalation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTag" ADD CONSTRAINT "LeadTag_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTag" ADD CONSTRAINT "LeadTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappConversation" ADD CONSTRAINT "WhatsappConversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappConversation" ADD CONSTRAINT "WhatsappConversation_whatsappProviderConfigId_fkey" FOREIGN KEY ("whatsappProviderConfigId") REFERENCES "WhatsappProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationFollowUp" ADD CONSTRAINT "ConversationFollowUp_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsappConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTag" ADD CONSTRAINT "ConversationTag_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsappConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTag" ADD CONSTRAINT "ConversationTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsappConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "WhatsappProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_workUnitId_fkey" FOREIGN KEY ("workUnitId") REFERENCES "WorkUnitEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "ProfissionalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_whatsappProviderConfigId_fkey" FOREIGN KEY ("whatsappProviderConfigId") REFERENCES "WhatsappProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarAttendee" ADD CONSTRAINT "CalendarAttendee_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarReminder" ADD CONSTRAINT "CalendarReminder_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfissionalEntity" ADD CONSTRAINT "ProfissionalEntity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfissionalAvailability" ADD CONSTRAINT "ProfissionalAvailability_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "ProfissionalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkUnitEntity" ADD CONSTRAINT "WorkUnitEntity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfissionalWorkProfile" ADD CONSTRAINT "ProfissionalWorkProfile_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "ProfissionalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfissionalWorkProfile" ADD CONSTRAINT "ProfissionalWorkProfile_workUnitId_fkey" FOREIGN KEY ("workUnitId") REFERENCES "WorkUnitEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgHierarchyItem" ADD CONSTRAINT "OrgHierarchyItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgHierarchyItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgHierarchyItem" ADD CONSTRAINT "OrgHierarchyItem_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgHierarchyItem" ADD CONSTRAINT "OrgHierarchyItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerNotification" ADD CONSTRAINT "OwnerNotification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConfig" ADD CONSTRAINT "AiConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionLog" ADD CONSTRAINT "DecisionLog_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsappConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProfile" ADD CONSTRAINT "FinancialProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "FinancialProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialCategory" ADD CONSTRAINT "FinancialCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "FinancialProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_recurringBillId_fkey" FOREIGN KEY ("recurringBillId") REFERENCES "RecurringBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_installmentPlanId_fkey" FOREIGN KEY ("installmentPlanId") REFERENCES "InstallmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBill" ADD CONSTRAINT "RecurringBill_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "FinancialProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBill" ADD CONSTRAINT "RecurringBill_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBill" ADD CONSTRAINT "RecurringBill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "FinancialProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProofSession" ADD CONSTRAINT "FinancialProofSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectSegment" ADD CONSTRAINT "ProspectSegment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingRun" ADD CONSTRAINT "SourcingRun_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "ProspectSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectLead" ADD CONSTRAINT "ProspectLead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectLead" ADD CONSTRAINT "ProspectLead_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "ProspectSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectLead" ADD CONSTRAINT "ProspectLead_templateUsadoId_fkey" FOREIGN KEY ("templateUsadoId") REFERENCES "TemplateProspeccao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateProspeccao" ADD CONSTRAINT "TemplateProspeccao_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisparoConfig" ADD CONSTRAINT "DisparoConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "WhatsappBusinessOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfertaGerada" ADD CONSTRAINT "OfertaGerada_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

