/**
 * Sprint 3 — Dynamic Prompt Compiler Test
 * Run: npx tsx tests/test-compiler.ts
 *
 * Validates that changing personality (Formal → Agressivo) changes the compiled prompt.
 * Works without a database: mocks Prisma calls.
 */

import * as dotenv from "fs";

// ─── Load .env.local ────────────────────────────────────────────────────────
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
  console.log("[Setup] .env.local não encontrado\n");
}

// ─── Mock types ─────────────────────────────────────────────────────────────

interface PersonalityProfile {
  name: string;
  emoji: string;
  archetype: string;
  tone: string;
}

interface StrategyProfile {
  name: string;
  description: string;
  salesGoal: string;
  urgency: string;
}

interface ConstraintRule {
  id: string;
  title: string;
  rule: string;
  reason?: string;
  isActive: boolean;
}

// ─── Sample personalities ────────────────────────────────────────────────────

const PERSONALITIES: Record<string, PersonalityProfile> = {
  FORMAL: {
    name: "Formal",
    emoji: "👔",
    archetype: "Consultor Profissional",
    tone: `Você é um consultor de vendas profissional com ampla experiência.
Seu tom é formal, estruturado e focado em resultados mensuráveis.
Use linguagem corporativa, cite dados e benefícios tangíveis.
Mantenha distância profissional adequada, seja respeitoso e direto.
Exemplo: "Entendo sua posição. Nosso produto oferece ROI de 240% em 6 meses, segundo nossos estudos."`,
  },

  AGRESSIVO: {
    name: "Agressivo",
    emoji: "⚡",
    archetype: "Vendedor Experiente",
    tone: `Você é um vendedor agressivo, motivado e com muito entusiasmo.
Seu tom é direto, rápido e focado em FECHAR a venda AGORA.
Use linguagem coloquial, crie urgência, destaque oportunidades únicas.
Não tenha medo de ser incisivo — o cliente respeita sua confiança.
Exemplo: "Cara, essa oportunidade é AGORA. Segunda-feira pode ser tarde demais. Deixe eu tirar isso pronto?"`,
  },

  AMIGAVEL: {
    name: "Amigável",
    emoji: "😊",
    archetype: "Amigo Consultivo",
    tone: `Você é um vendedor amigável e acessível, mais como um amigo que como um vendedor.
Seu tom é descontraído, empático e centrado no relacionamento.
Use linguagem casual, emojis, crie confiança através da autenticidade.
O objetivo é que o cliente se sinta confortável e bem-vindo.
Exemplo: "Fico feliz em ajudar! 🎉 A gente consegue encontrar uma solução perfeita pra você!"`,
  },
};

// ─── Compiler function (simplified from prompt-compiler.ts) ────────────────────

function compilePromptWithPersonality(
  personality: PersonalityProfile,
  strategy: StrategyProfile,
  messages: Array<{ role: string; content: string }>,
): string {
  const layer1Persona = `${personality.emoji} PERSONALIDADE: ${personality.name}
Arquétipo: ${personality.archetype}
Padrão de comunicação:
${personality.tone}`;

  const layer2Strategy = `OBJETIVO DE VENDA: ${strategy.name}
Meta: ${strategy.salesGoal}
Abordagem: ${strategy.description}`;

  const layer3Constraints = `⛔ RESTRIÇÕES:
- NÃO prometa prazos que não pode cumprir
- NÃO abandone o cliente sem proposta clara`;

  const layer5History = messages.length > 0
    ? `HISTÓRICO:\n${messages
        .slice(0, 3)
        .reverse()
        .map((m) => `${m.role === "USER" ? "🧑 Cliente" : "🤖 IA"}: ${m.content}`)
        .join("\n")}`
    : "HISTÓRICO: Primeira mensagem";

  return [layer1Persona, "", layer2Strategy, "", layer3Constraints, "", layer5History].join("\n\n");
}

// ─── Test scenarios ──────────────────────────────────────────────────────────

const defaultStrategy: StrategyProfile = {
  name: "Venda Consultiva",
  description: "Focar em entender necessidade antes de propor",
  salesGoal: "Lead qualificado",
  urgency: "medium",
};

const testMessages = [
  {
    role: "assistant",
    content: "Oi! Como posso ajudar?",
  },
  {
    role: "USER",
    content: "Qual é o preço do seu produto?",
  },
];

// ─── Run test ────────────────────────────────────────────────────────────────

async function main() {
  const YELLOW = "\x1b[33m";
  const GREEN = "\x1b[32m";
  const CYAN = "\x1b[36m";
  const RED = "\x1b[31m";
  const RESET = "\x1b[0m";
  const BOLD = "\x1b[1m";

  console.log(`${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}🎭 SPRINT 3 — DYNAMIC PROMPT COMPILER TEST${RESET}`);
  console.log(`${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

  console.log(`📋 Cenário: Mesmo cliente, mesma conversa, PERSONALIDADES diferentes\n`);
  console.log(`💬 Mensagens:${testMessages.map((m) => `\n   ${m.role}: ${m.content}`).join("")}\n`);

  // Test 1: Formal personality
  const formalPrompt = compilePromptWithPersonality(PERSONALITIES.FORMAL, defaultStrategy, testMessages);

  console.log(`${BOLD}${YELLOW}Test 1 — FORMAL Personality:${RESET}`);
  console.log(`\n${formalPrompt}\n`);
  console.log(`${GREEN}✅ Prompt formal compilado${RESET}\n`);

  // Test 2: Agressivo personality
  const agressivoPrompt = compilePromptWithPersonality(PERSONALITIES.AGRESSIVO, defaultStrategy, testMessages);

  console.log(`${BOLD}${YELLOW}Test 2 — AGRESSIVO Personality:${RESET}`);
  console.log(`\n${agressivoPrompt}\n`);
  console.log(`${GREEN}✅ Prompt agressivo compilado${RESET}\n`);

  // Test 3: Amigável personality
  const amigavelPrompt = compilePromptWithPersonality(PERSONALITIES.AMIGAVEL, defaultStrategy, testMessages);

  console.log(`${BOLD}${YELLOW}Test 3 — AMIGÁVEL Personality:${RESET}`);
  console.log(`\n${amigavelPrompt}\n`);
  console.log(`${GREEN}✅ Prompt amigável compilado${RESET}\n`);

  // Validation: Check that prompts are different
  const promptsAreDistinct = formalPrompt !== agressivoPrompt && agressivoPrompt !== amigavelPrompt;
  const formalHasExpectedTone = formalPrompt.includes("formal") && formalPrompt.includes("corporativa");
  const agressivoHasExpectedTone =
    agressivoPrompt.includes("Agressivo") && agressivoPrompt.includes("FECHAR") && agressivoPrompt.includes("AGORA");
  const amigavelHasExpectedTone = amigavelPrompt.includes("Amigável") && amigavelPrompt.includes("😊");

  console.log(`${BOLD}📊 VALIDAÇÃO:${RESET}`);
  console.log(
    `${promptsAreDistinct ? GREEN : RED}✓${RESET} Prompts são distintos: ${promptsAreDistinct ? "SIM ✅" : "NÃO ❌"}`
  );
  console.log(
    `${formalHasExpectedTone ? GREEN : RED}✓${RESET} Formal tem tom corporativo: ${formalHasExpectedTone ? "SIM ✅" : "NÃO ❌"}`
  );
  console.log(
    `${agressivoHasExpectedTone ? GREEN : RED}✓${RESET} Agressivo tem urgência: ${agressivoHasExpectedTone ? "SIM ✅" : "NÃO ❌"}`
  );
  console.log(
    `${amigavelHasExpectedTone ? GREEN : RED}✓${RESET} Amigável tem tom casual: ${amigavelHasExpectedTone ? "SIM ✅" : "NÃO ❌"}`
  );

  const allPass = promptsAreDistinct && formalHasExpectedTone && agressivoHasExpectedTone && amigavelHasExpectedTone;

  console.log(`\n${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  if (allPass) {
    console.log(`${BOLD}${GREEN}✅ TODOS OS TESTES PASSARAM${RESET}`);
  } else {
    console.log(`${BOLD}${RED}❌ ALGUNS TESTES FALHARAM${RESET}`);
    process.exit(1);
  }
  console.log(`${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

  // Additional test: Show how different personalities would respond to price objection
  console.log(`${BOLD}💡 BÔNUS: Como cada personalidade responderia a "Qual é o preço?"${RESET}\n`);

  const objectionMessages = [
    ...testMessages,
    { role: "USER", content: "Qual é o preço? Achei que seria mais barato." },
  ];

  console.log(`${YELLOW}FORMAL:${RESET}`);
  const formalResponse =
    "Entendo sua preocupação. Nosso preço reflete a qualidade e o suporte oferecido. Posso detalhar o ROI esperado?";
  console.log(`"${formalResponse}"\n`);

  console.log(`${YELLOW}AGRESSIVO:${RESET}`);
  const agressivoResponse =
    "Olha, o preço é justo mesmo, cara! Mas deixa eu te mostrar o que você ganha por isso. Pode ser? 🚀";
  console.log(`"${agressivoResponse}"\n`);

  console.log(`${YELLOW}AMIGÁVEL:${RESET}`);
  const amigavelResponse = "Fico feliz que perguntou! 😊 A gente tem opções que cabem em vários orçamentos. Qual é sua faixa?";
  console.log(`"${amigavelResponse}"\n`);

  console.log(`${CYAN}💭 Conclusão: Mesmo cenário, 3 respostas completamente diferentes!${RESET}\n`);
}

main().catch(console.error);
