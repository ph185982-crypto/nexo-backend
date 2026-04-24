/**
 * Sprint 2 — Decision Engine Test
 * Run: npx tsx tests/test-decision.ts
 *
 * Tests 3 real-world scenarios and prints action + reasoning.
 * Works without a database: logs are printed to console instead of Prisma.
 */

import * as dotenv from "fs";

// ─── Load .env.local if available ────────────────────────────────────────────
try {
  const envFile = dotenv.readFileSync(".env.local", "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
  console.log("[Setup] .env.local carregado\n");
} catch {
  console.log("[Setup] .env.local não encontrado — usando apenas variáveis de ambiente do shell\n");
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DecisionAction = "RESPOND" | "FOLLOW_UP" | "ESCALATE" | "WAIT" | "CLOSE";

interface ConversationHistory {
  role: "user" | "assistant";
  content: string;
}

interface LeadStateInput {
  etapa: string;
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
  source: "LLM" | "FALLBACK";
}

// ─── LLM callers (mirrors decision.ts) ───────────────────────────────────────

async function callOpenAI(system: string, history: ConversationHistory[], user: string, model: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, ...history, { role: "user", content: user }],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });
    if (!res.ok) { console.error("[OpenAI]", await res.text()); return null; }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) { console.error("[OpenAI]", e); return null; }
}

async function callAnthropic(system: string, history: ConversationHistory[], user: string, model: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, system, messages: [...history, { role: "user", content: user }], max_tokens: 300 }),
    });
    if (!res.ok) { console.error("[Anthropic]", await res.text()); return null; }
    const data = await res.json() as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text ?? null;
  } catch (e) { console.error("[Anthropic]", e); return null; }
}

async function callGemini(system: string, history: ConversationHistory[], user: string, model: string): Promise<string | null> {
  if (!process.env.GOOGLE_AI_API_KEY) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [
          ...history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
          { role: "user", parts: [{ text: user }] },
        ],
        generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
      }),
    });
    if (!res.ok) { console.error("[Gemini]", await res.text()); return null; }
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (e) { console.error("[Gemini]", e); return null; }
}

async function callLLM(system: string, history: ConversationHistory[], user: string, provider?: string | null, model?: string | null): Promise<string | null> {
  const p = provider?.toUpperCase();
  if (p === "ANTHROPIC") { const r = await callAnthropic(system, history, user, model ?? "claude-haiku-4-5-20251001"); if (r) return r; }
  if (p === "OPENAI")    { const r = await callOpenAI(system, history, user, model ?? "gpt-4o-mini"); if (r) return r; }
  if (p === "GOOGLE")    { const r = await callGemini(system, history, user, model ?? "gemini-2.0-flash-lite"); if (r) return r; }
  // Fallback chain
  const anthropicR = await callAnthropic(system, history, user, "claude-haiku-4-5-20251001"); if (anthropicR) return anthropicR;
  const geminiR    = await callGemini(system, history, user, "gemini-2.0-flash-lite");        if (geminiR) return geminiR;
  const openaiR    = await callOpenAI(system, history, user, "gpt-4o-mini");                  if (openaiR) return openaiR;
  return null;
}

// ─── Fallback rule-based decision ────────────────────────────────────────────

function makeFallbackDecision(history: ConversationHistory[], leadState: LeadStateInput, msg: string): DecisionOutput {
  const m = msg.toLowerCase();
  const aiCount = history.filter((h) => h.role === "assistant").length;

  if (/insatisfeito|problema|reclamação|cansei|ninguém responde/.test(m)) {
    return { action: "ESCALATE", targetState: "ESCALATED", reasoning: "Sinais de insatisfação detectados pela regra de fallback", source: "FALLBACK" };
  }
  if (/quero|assinar|comprar|fechar|confirmar|fechado|bora/.test(m)) {
    return { action: "RESPOND", targetState: "CLOSING", reasoning: "Intenção de compra clara — resposta imediata pela regra de fallback", source: "FALLBACK" };
  }
  if (/caro|não tenho interesse|não quero|muito caro|sem interesse/.test(m)) {
    return { action: "RESPOND", targetState: "OBJECTION", reasoning: "Objeção de preço/interesse detectada pela regra de fallback", source: "FALLBACK" };
  }
  if (leadState.foraAreaEntrega) {
    return { action: "CLOSE", targetState: "LOST", reasoning: "Fora da área de entrega pela regra de fallback", source: "FALLBACK" };
  }
  if (aiCount >= 3 && history[history.length - 1]?.role === "assistant") {
    return { action: "FOLLOW_UP", targetState: null, reasoning: "Sem resposta após múltiplos contatos pela regra de fallback", source: "FALLBACK" };
  }
  return { action: "RESPOND", targetState: "ENGAGED", reasoning: "Padrão: responder ao cliente pela regra de fallback", source: "FALLBACK" };
}

// ─── LLM Router decision ──────────────────────────────────────────────────────

async function makeLLMDecision(
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

Retorne um JSON com EXATAMENTE esta estrutura (sem markdown, sem blocos de código):
{"action":"RESPOND","targetState":"ENGAGED","reasoning":"explicação breve"}`;

  const historyText = history.map((m) => `[${m.role === "user" ? "CLIENTE" : "IA"}] ${m.content}`).join("\n");
  const userPrompt = `Histórico:\n${historyText || "(sem histórico)"}\n\nNova mensagem: "${incomingMessage}"\n\nQual a próxima ação?`;

  const raw = await callLLM(systemPrompt, history, userPrompt, config.aiProvider, config.aiModel);
  if (!raw) return null;

  try {
    // Extract JSON — sometimes the LLM wraps it in markdown code fences
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      action: parsed.action as DecisionAction,
      targetState: parsed.targetState ?? null,
      reasoning: parsed.reasoning ?? "Sem explicação",
      source: "LLM",
    };
  } catch {
    console.warn("[LLM] JSON parse failed on:", raw.slice(0, 200));
    return null;
  }
}

// ─── Decision runner ─────────────────────────────────────────────────────────

async function decide(
  label: string,
  expectedAction: string,
  expectedState: string,
  history: ConversationHistory[],
  leadState: LeadStateInput,
  incomingMessage: string,
): Promise<void> {
  const config: AgentConfigInput = {
    currentPrompt: "Você é Pedro, um vendedor de ferramentas e equipamentos da Nexo Brasil.",
    agentName: "Pedro",
    escalationThreshold: 3,
    aiProvider: null,
    aiModel: null,
  };

  const YELLOW = "\x1b[33m";
  const GREEN = "\x1b[32m";
  const RED = "\x1b[31m";
  const CYAN = "\x1b[36m";
  const RESET = "\x1b[0m";
  const BOLD = "\x1b[1m";

  console.log(`${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}🧪 ${label}${RESET}`);
  console.log(`   Mensagem: "${incomingMessage}"`);
  console.log(`   Estado atual do lead: etapa=${leadState.etapa}`);
  console.log(`   Esperado: action=${YELLOW}${expectedAction}${RESET} | state=${YELLOW}${expectedState}${RESET}`);
  console.log();

  // Try LLM first
  let decision = await makeLLMDecision(history, leadState, config, incomingMessage);

  if (!decision) {
    console.log(`   ${YELLOW}⚠ LLM indisponível — usando fallback rule-based${RESET}`);
    decision = makeFallbackDecision(history, leadState, incomingMessage);
  }

  const actionMatch = decision.action === expectedAction;
  const stateMatch = !expectedState || decision.targetState?.includes(expectedState) || expectedState.includes(decision.targetState ?? "");

  console.log(`   Source:      ${decision.source === "LLM" ? "🤖 LLM" : "📐 Fallback Rules"}`);
  console.log(`   Action:      ${actionMatch ? GREEN : RED}${decision.action}${RESET} ${actionMatch ? "✅" : `❌ (esperado: ${expectedAction})`}`);
  console.log(`   TargetState: ${stateMatch ? GREEN : RED}${decision.targetState ?? "null"}${RESET} ${stateMatch ? "✅" : `❌ (esperado: ${expectedState})`}`);
  console.log(`   Reasoning:   "${decision.reasoning}"`);
  console.log();
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n\x1b[1m\x1b[35m🧠 SPRINT 2 — DECISION ENGINE TEST\x1b[0m");
  console.log("\x1b[35mValidação dos 3 cenários reais do sistema de roteamento\x1b[0m\n");

  // ── Cenário A: Novo Lead ───────────────────────────────────────────────────
  await decide(
    "Cenário A — Novo Lead (primeiro contato)",
    "RESPOND",
    "ENGAGED",
    [], // sem histórico
    {
      etapa: "NOVO",
      midiaEnviada: false,
      localizacaoRecebida: false,
      foraAreaEntrega: false,
      produtoInteresse: null,
    },
    "Olá, gostaria de saber mais sobre o produto",
  );

  // ── Cenário B: Objeção de Preço ────────────────────────────────────────────
  await decide(
    "Cenário B — Objeção de preço/interesse",
    "RESPOND",
    "OBJECTION",
    [
      { role: "assistant", content: "Olá! Bem-vindo à Nexo Brasil. Temos ótimos produtos! No que posso ajudar?" },
      { role: "user", content: "Me fala mais sobre as ferramentas" },
      { role: "assistant", content: "Claro! Temos ferramentas de alta qualidade com garantia. Qual seria o seu interesse?" },
    ],
    {
      etapa: "QUALIFICANDO",
      midiaEnviada: true,
      localizacaoRecebida: false,
      foraAreaEntrega: false,
      produtoInteresse: "FERRAMENTA",
    },
    "Achei muito caro, não tenho interesse agora",
  );

  // ── Cenário C: Fechamento ─────────────────────────────────────────────────
  await decide(
    "Cenário C — Intenção de fechamento/assinatura",
    "RESPOND",
    "CLOSING",
    [
      { role: "assistant", content: "Olá! Como posso ajudar?" },
      { role: "user", content: "Quero saber sobre o produto X" },
      { role: "assistant", content: "Produto X custa R$299. Entregamos em todo Goiânia." },
      { role: "user", content: "Qual o prazo de entrega?" },
      { role: "assistant", content: "Entregamos no mesmo dia se pedido até as 15h!" },
    ],
    {
      etapa: "NEGOCIANDO",
      midiaEnviada: true,
      localizacaoRecebida: true,
      foraAreaEntrega: false,
      produtoInteresse: "PRODUTO_X",
    },
    "Tudo certo, quero assinar agora!",
  );

  console.log("\x1b[1m\x1b[35m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m");
  console.log("\x1b[1m✅ Testes concluídos\x1b[0m\n");
}

main().catch(console.error);
