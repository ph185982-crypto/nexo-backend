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
- Seja conciso e direto (máximo 3 parágrafos por resposta)
- Se o cliente demonstrar interesse alto ou urgência, use a flag [ESCALAR] no início da resposta
- Se o cliente quiser agendar, use a flag [AGENDAR] no início da resposta
- Mantenha um tom profissional mas acolhedor
- Não invente informações sobre produtos/serviços que não conhece`;

export async function processAIResponse(
  conversationId: string,
  userMessage: string,
  agent: AgentConfig
): Promise<void> {
  try {
    const [recentMessages, conversation] = await Promise.all([
      // Fix 1: Fetch the 20 MOST RECENT messages (desc), then reverse for chronological order
      prisma.whatsappMessage.findMany({
        where: { conversationId },
        orderBy: { sentAt: "desc" },
        take: 20,
      }),
      prisma.whatsappConversation.findUnique({
        where: { id: conversationId },
        include: {
          provider: true,
          lead: true, // Fix 3: include lead for context injection
        },
      }),
    ]);

    if (!conversation) return;

    // Fix 2: Stop AI if lead has already been escalated — let the human handle it
    if (conversation.lead?.status === "ESCALATED") {
      return;
    }

    // Fix 3: Build lead context header to inject into system prompt
    const lead = conversation.lead;
    const leadContext = lead
      ? [
          `\n\n--- CONTEXTO DO LEAD ---`,
          `Nome: ${lead.profileName ?? "Não informado"}`,
          `Telefone: ${lead.phoneNumber}`,
          `Email: ${lead.email ?? "Não informado"}`,
          `Origem: ${lead.leadOrigin === "INBOUND" ? "Tráfego de entrada (inbound)" : "Abordagem ativa (outbound)"}`,
          `Status: ${lead.status}`,
          `Cliente desde: ${lead.createdAt.toLocaleDateString("pt-BR")}`,
          `--- FIM DO CONTEXTO ---`,
        ].join("\n")
      : "";

    const systemPromptWithContext = (agent.systemPrompt ?? DEFAULT_SYSTEM_PROMPT) + leadContext;

    // Messages fetched desc → reverse to get chronological order for LLM.
    // Exclude the last message (the one just saved = userMessage) to avoid
    // sending it twice — it is appended separately as the current turn.
    const chatHistory = recentMessages
      .reverse()
      .slice(0, -1) // drop last = current user message already in userMessage param
      .map((m) => ({
        role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));

    // Call LLM using the agent's configured provider and model
    const response = await callLLM(
      systemPromptWithContext,
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
      .replace(/^\[ESCALAR\]\s*/i, "")
      .replace(/^\[AGENDAR\]\s*/i, "")
      .trim();

    if (!cleanResponse) return;

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
      provider.accessToken ?? undefined
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
    return callOpenAI(systemPrompt, history, userMessage, aiModel ?? "gpt-4o-mini");
  }
  if (provider === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY) {
    return callAnthropic(systemPrompt, history, userMessage, aiModel ?? "claude-sonnet-4-6");
  }
  if (provider === "GOOGLE" && process.env.GOOGLE_AI_API_KEY) {
    return callGemini(systemPrompt, history, userMessage, aiModel ?? "gemini-2.0-flash-lite");
  }

  // Auto-detect from available keys (priority: Anthropic → Google → OpenAI)
  if (process.env.ANTHROPIC_API_KEY) {
    return callAnthropic(systemPrompt, history, userMessage, aiModel ?? "claude-sonnet-4-6");
  }
  if (process.env.GOOGLE_AI_API_KEY) {
    return callGemini(systemPrompt, history, userMessage, aiModel ?? "gemini-2.0-flash-lite");
  }
  if (process.env.OPENAI_API_KEY) {
    return callOpenAI(systemPrompt, history, userMessage, aiModel ?? "gpt-4o-mini");
  }

  // No LLM configured — send fallback message
  console.warn("[AI Agent] No LLM API key configured — using fallback response");
  return "Olá! Recebi sua mensagem. Um de nossos atendentes entrará em contato em breve. 😊";
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
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userMessage },
      ],
      max_tokens: 600,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    console.error("[OpenAI] Error:", await response.text());
    return null;
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
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
      max_tokens: 600,
    }),
  });

  if (!response.ok) {
    console.error("[Anthropic] Error:", await response.text());
    return null;
  }

  const data = (await response.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? null;
}

async function callGemini(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  model: string
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_AI_API_KEY!;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Gemini uses "model" (not "assistant") for AI turns
  const geminiHistory = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [
        ...geminiHistory,
        { role: "user", parts: [{ text: userMessage }] },
      ],
      generationConfig: {
        maxOutputTokens: 600,
        temperature: 0.7,
      },
    }),
  });

  if (!response.ok) {
    console.error("[Gemini] Error:", await response.text());
    return null;
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
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

  // Only escalate once — if already escalated, skip
  if (lead.status === "ESCALATED") return;

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
      reason: reason.replace(/^\[ESCALAR\]\s*/i, "").substring(0, 500),
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

  // Notify about escalation in the conversation
  await prisma.whatsappMessage.create({
    data: {
      content: "🔔 *Lead escalado para atendimento humano.* Um vendedor assumirá esta conversa em breve.",
      type: "TEXT",
      role: "ASSISTANT",
      sentAt: new Date(),
      status: "SENT",
      conversationId,
    },
  });
}
