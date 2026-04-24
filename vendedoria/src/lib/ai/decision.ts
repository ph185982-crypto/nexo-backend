import { prisma } from "@/lib/prisma/client";

// ─── Decision Engine: Routes between RESPOND, FOLLOW_UP, ESCALATE, WAIT, CLOSE ──

type DecisionAction = "RESPOND" | "FOLLOW_UP" | "ESCALATE" | "WAIT" | "CLOSE";

interface ConversationHistory {
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
}

interface LeadStateInput {
  etapa: string; // NOVO | PRODUTO_IDENTIFICADO | MIDIA_ENVIADA | etc.
  midiaEnviada: boolean;
  localizacaoRecebida: boolean;
  foraAreaEntrega: boolean;
  produtoInteresse: string | null;
}

interface AgentConfigInput {
  currentPrompt: string;
  agentName: string;
  escalationThreshold: number;
  aiProvider?: string | null;
  aiModel?: string | null;
}

interface DecisionOutput {
  action: DecisionAction;
  targetState: string | null;
  reasoning: string;
  metadata?: Record<string, unknown>;
}

// ─── LLM Router: Calls LLM to decide the next action ──────────────────────────

async function callLLMRouter(
  history: ConversationHistory[],
  leadState: LeadStateInput,
  config: AgentConfigInput,
  incomingMessage: string,
): Promise<DecisionOutput | null> {
  const systemPrompt = `Você é um sistema de roteamento de decisões para um agente de vendas AI.
Sua tarefa é analisar o histórico de conversa e o estado do lead para decidir a próxima ação.

Ações possíveis:
- RESPOND: Responder imediatamente ao cliente com uma mensagem (padrão para leads ativos).
- FOLLOW_UP: Marcar para follow-up automatizado (cliente não respondeu por tempo).
- WAIT: Aguardar antes de tomar ação (ex: aguardando informação).
- ESCALATE: Encaminhar para humano (lead muito insatisfeito, pedido de falar com alguém, etc).
- CLOSE: Encerrar conversa (lead perdido, opt-out, ou ciclo completo).

Estado atual do lead:
- Etapa: ${leadState.etapa}
- Mídia enviada: ${leadState.midiaEnviada}
- Localização recebida: ${leadState.localizacaoRecebida}
- Fora da área de entrega: ${leadState.foraAreaEntrega}
- Produto de interesse: ${leadState.produtoInteresse ?? "Não identificado"}

Retorne um JSON com EXATAMENTE esta estrutura (sem markdown):
{
  "action": "RESPOND|FOLLOW_UP|WAIT|ESCALATE|CLOSE",
  "targetState": "próximo estado do lead ou null",
  "reasoning": "explicação breve da decisão"
}`;

  const historyText = history
    .map((msg) => `[${msg.role === "user" ? "CLIENTE" : "IA"}] ${msg.content}`)
    .join("\n");

  const userPrompt = `Histórico da conversa:
${historyText}

Nova mensagem do cliente: "${incomingMessage}"

Baseado no histórico e na mensagem, qual é a próxima ação?`;

  try {
    const response = await callLLMForDecision(
      systemPrompt,
      history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
      userPrompt,
      config.aiProvider,
      config.aiModel,
    );

    if (!response) return null;

    // Parse the JSON response (expect: {"action": "...", "targetState": "...", "reasoning": "..."})
    const parsed = JSON.parse(response);

    return {
      action: (parsed.action || "RESPOND") as DecisionAction,
      targetState: parsed.targetState || null,
      reasoning: parsed.reasoning || "Sem explicação fornecida",
      metadata: { raw_response: response },
    };
  } catch (error) {
    console.error("[DecisionEngine] LLM Router error:", error);
    return null;
  }
}

// ─── Fallback Decision Logic (no LLM available) ──────────────────────────────

function makeFallbackDecision(
  history: ConversationHistory[],
  leadState: LeadStateInput,
  incomingMessage: string,
): DecisionOutput {
  const msgLower = incomingMessage.toLowerCase();
  const responseCount = history.filter((h) => h.role === "assistant").length;

  // Escalation signals
  if (/insatisfeito|problema|reclamação|não quer|chega|cansei|ninguém responde/.test(msgLower)) {
    return {
      action: "ESCALATE",
      targetState: "ESCALATED",
      reasoning: "Cliente mostrou sinais de insatisfação ou reclamação",
    };
  }

  // Immediate response signals (hot lead)
  if (/quero|compra|vou|confirma|fecha|pedido|paga/.test(msgLower)) {
    return {
      action: "RESPOND",
      targetState: "NEGOCIANDO",
      reasoning: "Cliente mostrou interesse de compra — resposta imediata",
    };
  }

  // Ask for location signals
  if (leadState.etapa === "NOVO" && !leadState.localizacaoRecebida && !leadState.midiaEnviada) {
    return {
      action: "RESPOND",
      targetState: "QUALIFICANDO",
      reasoning: "Primeiro contato — solicitar informações",
    };
  }

  // Out of delivery area
  if (leadState.foraAreaEntrega) {
    return {
      action: "CLOSE",
      targetState: "PERDIDO",
      reasoning: "Cliente está fora da área de entrega",
    };
  }

  // No response for a while (threshold: 3+ IA messages without client response)
  if (responseCount >= 3 && history[history.length - 1]?.role === "assistant") {
    return {
      action: "FOLLOW_UP",
      targetState: null,
      reasoning: "Sem respostas após múltiplas tentativas — agendar follow-up",
    };
  }

  // Default: respond to any client message
  return {
    action: "RESPOND",
    targetState: null,
    reasoning: "Padrão: responder ao cliente",
  };
}

// ─── LLM Caller (reuses logic from agent.ts) ────────────────────────────────

async function callLLMForDecision(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  aiProvider?: string | null,
  aiModel?: string | null,
): Promise<string | null> {
  const p = aiProvider?.toUpperCase();
  // Try configured provider first
  if (p === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY) {
    const r = await callAnthropic(systemPrompt, history, userMessage, aiModel ?? "claude-haiku-4-5-20251001");
    if (r) return r;
  }
  if (p === "OPENAI" && process.env.OPENAI_API_KEY) {
    const r = await callOpenAI(systemPrompt, history, userMessage, aiModel ?? "gpt-4o-mini");
    if (r) return r;
  }
  if (p === "GOOGLE" && process.env.GOOGLE_AI_API_KEY) {
    const r = await callGemini(systemPrompt, history, userMessage, aiModel ?? "gemini-2.0-flash-lite");
    if (r) return r;
  }
  // Fallback chain
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await callAnthropic(systemPrompt, history, userMessage, "claude-haiku-4-5-20251001");
    if (r) return r;
  }
  if (process.env.GOOGLE_AI_API_KEY) {
    const r = await callGemini(systemPrompt, history, userMessage, "gemini-2.0-flash-lite");
    if (r) return r;
  }
  if (process.env.OPENAI_API_KEY) {
    const r = await callOpenAI(systemPrompt, history, userMessage, "gpt-4o-mini");
    if (r) return r;
  }
  console.warn("[DecisionEngine] Nenhuma API key de LLM disponível");
  return null;
}

async function callOpenAI(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  model: string,
): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userMessage }],
      max_tokens: 300,
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    console.error("[OpenAI] Error:", await res.text());
    return null;
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? null;
}

async function callAnthropic(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  model: string,
): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: [...history, { role: "user", content: userMessage }],
      max_tokens: 300,
    }),
  });
  if (!res.ok) {
    console.error("[Anthropic] Error:", await res.text());
    return null;
  }
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? null;
}

async function callGemini(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  model: string,
): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [
        ...history.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        { role: "user", parts: [{ text: userMessage }] },
      ],
      generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
    }),
  });
  if (!res.ok) {
    console.error("[Gemini] Error:", await res.text());
    return null;
  }
  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

// ─── Main Decision Service ──────────────────────────────────────────────────

export async function makeDecision(
  conversationId: string,
  history: ConversationHistory[],
  leadState: LeadStateInput,
  config: AgentConfigInput,
  incomingMessage: string,
): Promise<DecisionOutput> {
  // Try LLM router first
  let decision = await callLLMRouter(history, leadState, config, incomingMessage);

  // Fall back to rule-based decision if LLM fails
  if (!decision) {
    console.warn("[DecisionEngine] LLM router failed, using fallback rules");
    decision = makeFallbackDecision(history, leadState, incomingMessage);
  }

  // Log the decision
  try {
    await prisma.decisionLog.create({
      data: {
        conversationId,
        action: decision.action,
        targetState: decision.targetState,
        reasoning: decision.reasoning,
        metadata: decision.metadata ? JSON.stringify(decision.metadata) : undefined,
      },
    });
  } catch (error) {
    console.error("[DecisionEngine] Failed to log decision:", error);
    // Don't fail the entire flow if logging fails
  }

  return decision;
}
