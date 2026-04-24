import { prisma } from "@/lib/prisma/client";

// ─── Prompt Compiler: Dynamically assembles prompts from configurable layers ──

export interface CompiledPrompt {
  systemPrompt: string;
  layers: {
    layer1_persona: string;
    layer2_strategy: string;
    layer3_constraints: string;
    layer4_objectionRules: string;
    layer5_history: string;
  };
  metadata: {
    personalityName?: string;
    strategyName?: string;
    objectionsFound?: string[];
  };
}

/**
 * Main compiler function that assembles a complete prompt from 5 layers.
 * Called when DecisionService decides action = "RESPOND"
 */
export async function compilePrompt(
  conversationId: string,
  recentMessages: Array<{ role: string; content: string }>,
  decisionContext?: {
    action?: string;
    targetState?: string | null;
  },
): Promise<CompiledPrompt> {
  // Load all required data
  const [agentConfig, conversation] = await Promise.all([
    prisma.agentConfig.findFirst({
      include: {
        personalityProfile: true,
        strategyProfile: true,
      },
    }),
    prisma.whatsappConversation.findUnique({
      where: { id: conversationId },
    }),
  ]);

  const layers = {
    layer1_persona: buildLayer1Persona(agentConfig?.personalityProfile),
    layer2_strategy: buildLayer2Strategy(agentConfig?.strategyProfile),
    layer3_constraints: await buildLayer3Constraints(),
    layer4_objectionRules: await buildLayer4ObjectionRules(recentMessages),
    layer5_history: buildLayer5History(recentMessages),
  };

  // Assemble final system prompt
  const systemPrompt = [
    layers.layer1_persona,
    "",
    layers.layer2_strategy,
    "",
    layers.layer3_constraints,
    "",
    layers.layer4_objectionRules,
    "",
    layers.layer5_history,
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");

  return {
    systemPrompt,
    layers,
    metadata: {
      personalityName: agentConfig?.personalityProfile?.name,
      strategyName: agentConfig?.strategyProfile?.name,
    },
  };
}

// ─── Layer 1: Persona (tone + archetype) ──────────────────────────────────────

function buildLayer1Persona(
  personality: { name: string; tone: string; archetype: string; emoji: string } | null | undefined,
): string {
  if (!personality) {
    return `${defaultPersonality().emoji} PERSONA PADRÃO:
Você é Pedro, um vendedor profissional da Nexo Brasil.
Você é conhecido por ser eficiente, confiável e focado em resultados.
Mantenha tom profissional, direto e amigável.`;
  }

  return `${personality.emoji} PERSONALIDADE: ${personality.name}
Arquétipo: ${personality.archetype}
Padrão de comunicação:
${personality.tone}`;
}

// ─── Layer 2: Strategy (sales goal + urgency) ────────────────────────────────

function buildLayer2Strategy(
  strategy: { name: string; description: string; salesGoal: string; urgency: string } | null | undefined,
): string {
  if (!strategy) {
    const def = defaultStrategy();
    return `OBJETIVO DE VENDA:
Meta: ${def.salesGoal}
Abordagem: ${def.description}
Urgência: ${def.urgency}`;
  }

  const urgencyLevel = {
    low: "Abordagem relaxada, sem pressa",
    medium: "Abordagem normal, equilibrada",
    high: "Abordagem ativa, buscar fechamento",
  };

  return `OBJETIVO DE VENDA: ${strategy.name}
Meta: ${strategy.salesGoal}
Abordagem: ${strategy.description}
Urgência: ${urgencyLevel[strategy.urgency as keyof typeof urgencyLevel] || strategy.urgency}`;
}

// ─── Layer 3: Constraints (what NOT to do) ────────────────────────────────────

async function buildLayer3Constraints(): Promise<string> {
  const constraints = await prisma.constraintRule.findMany({
    where: { isActive: true },
  });

  if (constraints.length === 0) {
    return `⛔ RESTRIÇÕES PADRÃO:
- NÃO prometa prazos de entrega que não pode cumprir
- NÃO faça promessas sobre descontos sem autorização
- NÃO compartilhe informações confidenciais de outros clientes
- NÃO abandone o cliente sem uma proposta clara de próximos passos`;
  }

  const constraintsList = constraints
    .map((c) => `- ${c.title}: ${c.rule}${c.reason ? ` (${c.reason})` : ""}`)
    .join("\n");

  return `⛔ RESTRIÇÕES — O QUE NÃO PODE FAZER:\n${constraintsList}`;
}

// ─── Layer 4: Contextual Rules (objection handling) ────────────────────────────

async function buildLayer4ObjectionRules(messages: Array<{ role: string; content: string }>): Promise<string> {
  // Extract keywords from recent messages to find relevant objection rules
  const recentText = messages
    .filter((m) => m.role === "USER")
    .slice(0, 5)
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();

  const keywords = ["caro", "concorrente", "prazo", "confiança", "não preciso", "sem interesse", "depois"];
  const foundObjections = await prisma.objectionRule.findMany({
    where: {
      isActive: true,
      keyword: { in: keywords },
    },
  });

  if (foundObjections.length === 0) {
    return "ℹ️ ESTRATÉGIAS DE OBJEÇÃO:\nResponda com calma, acknowledge a preocupação e ofereça alternativas.";
  }

  const objectionStrategies = foundObjections
    .map((rule) => {
      return `\n【${rule.keyword.toUpperCase()}】
Tipo: ${rule.objectionType}
Estratégia: ${rule.responseStrategy}
Contra-argumento: ${rule.counterArgument}`;
    })
    .join("\n");

  return `ℹ️ ESTRATÉGIAS DE OBJEÇÃO (palavras-chave detectadas):\n${objectionStrategies}`;
}

// ─── Layer 5: Conversation History ────────────────────────────────────────────

function buildLayer5History(messages: Array<{ role: string; content: string }>): string {
  if (messages.length === 0) {
    return `📋 HISTÓRICO:
(Primeira mensagem — sem histórico anterior)`;
  }

  const historyText = messages
    .slice(0, 10) // Last 10 messages
    .reverse()
    .map((m) => `${m.role === "USER" ? "🧑 Cliente" : "🤖 IA"}: ${m.content.substring(0, 150)}`)
    .join("\n");

  return `📋 HISTÓRICO RECENTE:\n${historyText}`;
}

// ─── Default profiles (fallback) ───────────────────────────────────────────────

function defaultPersonality() {
  return {
    name: "Professional",
    emoji: "👔",
    archetype: "Consultor",
    tone: `Você é um consultor de vendas experiente.
Seu tom é profissional, empático e orientado a soluções.
Escute o cliente, entenda suas necessidades e ofereça a melhor solução.`,
  };
}

function defaultStrategy() {
  return {
    name: "Consultative Selling",
    description: "Foco em entender necessidade → qualificar lead → propor solução adequada",
    salesGoal: "Lead qualificado e disponível para conversa",
    urgency: "medium",
  };
}

// ─── Debugging/Testing: Print layer breakdown ──────────────────────────────────

export function debugPrintCompiledPrompt(compiled: CompiledPrompt): void {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║ COMPILED PROMPT STRUCTURE                                   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log(`🎭 Layer 1 — PERSONA (${compiled.metadata.personalityName || "Default"}):\n${compiled.layers.layer1_persona}\n`);
  console.log(`🎯 Layer 2 — STRATEGY (${compiled.metadata.strategyName || "Default"}):\n${compiled.layers.layer2_strategy}\n`);
  console.log(`⛔ Layer 3 — CONSTRAINTS:\n${compiled.layers.layer3_constraints}\n`);
  console.log(`ℹ️ Layer 4 — OBJECTION RULES:\n${compiled.layers.layer4_objectionRules}\n`);
  console.log(`📋 Layer 5 — HISTORY:\n${compiled.layers.layer5_history}\n`);

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log(`Full System Prompt (${compiled.systemPrompt.length} chars):`);
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(compiled.systemPrompt);
  console.log("\n");
}
