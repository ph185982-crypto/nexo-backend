import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

interface AgentConfig {
  id: string;
  systemPrompt?: string | null;
  kind: string;
  status: string;
  aiProvider?: string | null;
  aiModel?: string | null;
}

const DEFAULT_SYSTEM_PROMPT = `Você é um assistente virtual de vendas para WhatsApp.
Seu objetivo é:
1. Cumprimentar o cliente de forma amigável e profissional
2. Entender a necessidade do cliente
3. Qualificar o lead (interesse, urgência, orçamento)
4. Apresentar os serviços/produtos disponíveis
5. Agendar uma reunião ou escalar para um vendedor humano quando necessário

Regras importantes:
- Responda sempre em português do Brasil
- Seja conciso e direto
- Se o cliente demonstrar interesse ou urgência alta, use a flag [ESCALAR] no início da resposta
- Se o cliente quiser agendar, use a flag [AGENDAR] no início da resposta
- Mantenha um tom profissional mas acolhedor`;

export async function processAIResponse(
  conversationId: string,
  userMessage: string,
  agent: AgentConfig
): Promise<void> {
  try {
    const [messages, conversation] = await Promise.all([
      prisma.whatsappMessage.findMany({
        where: { conversationId },
        orderBy: { sentAt: "asc" },
        take: 20,
      }),
      prisma.whatsappConversation.findUnique({
        where: { id: conversationId },
        include: { provider: true },
      }),
    ]);

    if (!conversation) return;

    // Build message history for LLM
    const chatHistory = messages.map((m) => ({
      role: m.role === "USER" ? "user" as const : "assistant" as const,
      content: m.content,
    }));

    // Call LLM using the agent's configured provider and model
    const response = await callLLM(
      agent.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      chatHistory,
      userMessage,
      agent.aiProvider ?? undefined,
      agent.aiModel ?? undefined
    );

    if (!response) return;

    // Check for escalation before saving
    if (response.startsWith("[ESCALAR]")) {
      await handleEscalation(conversation.leadId, conversationId, response);
    }

    const cleanResponse = response
      .replace("[ESCALAR]", "")
      .replace("[AGENDAR]", "")
      .trim();

    // Save AI response to DB
    await prisma.whatsappMessage.create({
      data: {
        content: cleanResponse,
        type: "TEXT",
        role: "ASSISTANT",
        sentAt: new Date(),
        status: "SENT",
        conversationId,
      },
    });

    await prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    // Send via WhatsApp Business API using the account's stored token
    const provider = conversation.provider;
    await sendWhatsAppMessage(
      provider.businessPhoneNumberId,
      conversation.customerWhatsappBusinessId,
      cleanResponse,
      provider.accessToken ?? undefined  // use DB token, falls back to ENV if null
    );
  } catch (error) {
    console.error("[AI Agent] Error:", error);
  }
}

async function callLLM(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  aiProvider?: string,
  aiModel?: string
): Promise<string | null> {
  const provider = aiProvider?.toUpperCase();

  if (provider === "OPENAI" && process.env.OPENAI_API_KEY) {
    return callOpenAI(systemPrompt, history, userMessage, aiModel ?? "gpt-4o");
  }
  if (provider === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY) {
    return callAnthropic(systemPrompt, history, userMessage, aiModel ?? "claude-sonnet-4-6");
  }

  // Auto-detect from available keys
  if (process.env.ANTHROPIC_API_KEY) {
    return callAnthropic(systemPrompt, history, userMessage, aiModel ?? "claude-sonnet-4-6");
  }
  if (process.env.OPENAI_API_KEY) {
    return callOpenAI(systemPrompt, history, userMessage, aiModel ?? "gpt-4o");
  }

  // No LLM configured — send fallback
  console.warn("[AI Agent] No LLM API key configured");
  return "Olá! Recebi sua mensagem. Um de nossos atendentes entrará em contato em breve.";
}

async function callOpenAI(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  model: string
): Promise<string | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userMessage },
      ],
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    console.error("[OpenAI] Error:", await response.text());
    return null;
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? null;
}

async function callAnthropic(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  model: string
): Promise<string | null> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: [
        ...history,
        { role: "user", content: userMessage },
      ],
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    console.error("[Anthropic] Error:", await response.text());
    return null;
  }

  const data = await response.json() as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? null;
}

async function handleEscalation(
  leadId: string,
  conversationId: string,
  reason: string
): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { kanbanColumn: true },
  });

  if (!lead) return;

  const escalatedColumn = await prisma.kanbanColumn.findFirst({
    where: { organizationId: lead.organizationId, type: "ESCALATED" },
  });

  if (escalatedColumn) {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        kanbanColumnId: escalatedColumn.id,
        status: "ESCALATED",
        lastActivityAt: new Date(),
      },
    });
  }

  await prisma.leadEscalation.create({
    data: {
      leadId,
      reason: reason.replace("[ESCALAR]", "").substring(0, 500),
      status: "PENDING",
    },
  });

  await prisma.leadActivity.create({
    data: {
      leadId,
      type: "STATUS_CHANGE",
      description: "Lead escalado para vendedor humano pela IA",
      createdBy: "AI_AGENT",
    },
  });

  // Notify about escalation in the conversation itself
  await prisma.whatsappMessage.create({
    data: {
      content: "🔔 Lead escalado para atendimento humano",
      type: "TEXT",
      role: "ASSISTANT",
      sentAt: new Date(),
      status: "SENT",
      conversationId,
    },
  });
}
