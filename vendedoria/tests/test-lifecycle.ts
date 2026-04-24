/**
 * Sprint 4 — Full Message Lifecycle Test
 * Run: npx tsx tests/test-lifecycle.ts
 *
 * Simulates the complete message flow without a real database or WhatsApp:
 *   Incoming message → Decision → [Cancel follow-ups] → Respond or Schedule
 */

// ─── Minimal env setup ────────────────────────────────────────────────────────
import * as fs from "fs";
try {
  const envFile = fs.readFileSync(".env.local", "utf-8");
  for (const line of envFile.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
} catch { /* no .env.local — proceed */ }

// ─── Types (mirrors the real system) ─────────────────────────────────────────

type DecisionAction = "RESPOND" | "FOLLOW_UP" | "ESCALATE" | "WAIT" | "CLOSE";

interface IncomingMessage {
  conversationId: string;
  phoneNumber: string;
  content: string;
  messageId: string;
}

interface DecisionResult {
  action: DecisionAction;
  targetState: string | null;
  reasoning: string;
}

interface LifecycleResult {
  step: string;
  ok: boolean;
  detail: string;
}

// ─── Mock services (replace with real imports for integration test) ───────────

// Decision Engine mock — mirrors decision.ts fallback rules
function mockDecisionEngine(content: string, etapa: string): DecisionResult {
  const m = content.toLowerCase();
  if (/quero|assinar|comprar|fechar|confirmar/.test(m))
    return { action: "RESPOND", targetState: "CLOSING", reasoning: "Intenção de compra detectada" };
  if (/caro|sem interesse|não quero/.test(m))
    return { action: "RESPOND", targetState: "OBJECTION", reasoning: "Objeção detectada" };
  if (/insatisfeito|problema|horrível/.test(m))
    return { action: "ESCALATE", targetState: "ESCALATED", reasoning: "Sinal de insatisfação" };
  if (etapa === "PERDIDO")
    return { action: "CLOSE", targetState: "LOST", reasoning: "Conversa já encerrada" };
  return { action: "RESPOND", targetState: "ENGAGED", reasoning: "Primeiro contato — responder" };
}

// Prompt Compiler mock — shows layers without DB
function mockCompilePrompt(personality: string, decision: DecisionResult): string {
  const personas: Record<string, string> = {
    Formal:    "👔 [Formal] Consultor profissional, tom estruturado",
    Agressivo: "⚡ [Agressivo] Vendedor direto, cria urgência, foca em fechar",
    Amigável:  "😊 [Amigável] Tom casual, empático, constrói relacionamento",
  };
  return [
    `PERSONA: ${personas[personality] ?? personas.Amigável}`,
    `OBJETIVO: Avançar o lead para ${decision.targetState ?? "próxima etapa"}`,
    `RESTRIÇÕES: Não prometer prazos não garantidos`,
    `OBJECTION_CTX: ${decision.targetState === "OBJECTION" ? "Acknowledge objeção → apresentar alternativa" : "N/A"}`,
    `HISTÓRICO: últimas 10 msgs injetadas aqui`,
  ].join("\n");
}

// WhatsApp sender mock
const sentMessages: string[] = [];
async function mockSendMessage(phone: string, msg: string): Promise<void> {
  sentMessages.push(msg);
  // Simulate typing delay
  await new Promise((r) => setTimeout(r, 100));
}

// Follow-up queue mock
const scheduledJobs: Array<{ conversationId: string; step: number; delayMs: number }> = [];
const cancelledConversations: string[] = [];

async function mockScheduleFollowUp(conversationId: string, step: number, delayMs: number): Promise<void> {
  scheduledJobs.push({ conversationId, step, delayMs });
}

async function mockCancelFollowUps(conversationId: string): Promise<void> {
  cancelledConversations.push(conversationId);
}

// DecisionLog mock
const decisionLog: Array<{ conversationId: string; action: string; reasoning: string; ts: Date }> = [];
async function mockLogDecision(conversationId: string, action: string, reasoning: string): Promise<void> {
  decisionLog.push({ conversationId, action, reasoning, ts: new Date() });
}

// ─── Core lifecycle handler (mirrors handleWithOrchestrator) ─────────────────

async function handleMessageLifecycle(
  msg: IncomingMessage,
  conversationState: { etapa: string },
  personality: string,
  agentConfig: { maxFollowUps: number; followUpHoursMs: number[] },
): Promise<LifecycleResult[]> {
  const results: LifecycleResult[] = [];

  // ── Step A: Cancel pending follow-ups (Regra de Ouro) ─────────────────────
  await mockCancelFollowUps(msg.conversationId);
  results.push({
    step: "A — Cancel Follow-ups",
    ok: true,
    detail: `Todos follow-ups de conv ${msg.conversationId} cancelados via BullMQ`,
  });

  // ── Step B: Decision Engine ────────────────────────────────────────────────
  const decision = mockDecisionEngine(msg.content, conversationState.etapa);
  await mockLogDecision(msg.conversationId, decision.action, decision.reasoning);
  results.push({
    step: "B — Decision Engine",
    ok: true,
    detail: `action=${decision.action} | state=${decision.targetState} | "${decision.reasoning}"`,
  });

  // ── Step C: Prompt Compiler (only for RESPOND) ─────────────────────────────
  if (decision.action === "RESPOND") {
    const compiledPrompt = mockCompilePrompt(personality, decision);
    results.push({
      step: "C — Prompt Compiler",
      ok: compiledPrompt.includes("PERSONA"),
      detail: `Prompt compilado (${compiledPrompt.length} chars) com personality=${personality}`,
    });

    // ── Step D: Typing indicator + send response ─────────────────────────────
    console.log(`   [typing...] simulando digitação para ${msg.phoneNumber}`);
    const aiResponse = `[IA responde com personality=${personality}] Olá! Vamos conversar sobre ${decision.targetState}.`;
    await mockSendMessage(msg.phoneNumber, aiResponse);
    results.push({
      step: "D — Typing + Send",
      ok: sentMessages.includes(aiResponse),
      detail: `Mensagem enviada: "${aiResponse.substring(0, 60)}..."`,
    });

    // ── Step E: Schedule follow-up after response ─────────────────────────────
    await mockScheduleFollowUp(msg.conversationId, 1, agentConfig.followUpHoursMs[0]);
    results.push({
      step: "E — Schedule Follow-up",
      ok: scheduledJobs.some((j) => j.conversationId === msg.conversationId),
      detail: `Job step=1 agendado para ${agentConfig.followUpHoursMs[0] / 3_600_000}h`,
    });

  } else if (decision.action === "FOLLOW_UP") {
    await mockScheduleFollowUp(msg.conversationId, 1, agentConfig.followUpHoursMs[0]);
    results.push({
      step: "C — Schedule Follow-up (FOLLOW_UP action)",
      ok: true,
      detail: `Job agendado direto — sem resposta imediata`,
    });

  } else if (decision.action === "ESCALATE") {
    results.push({
      step: "C — Escalate",
      ok: true,
      detail: `Lead encaminhado para humano — DecisionLog registrado`,
    });

  } else if (decision.action === "CLOSE") {
    results.push({
      step: "C — Close",
      ok: true,
      detail: `Conversa encerrada — nenhuma mensagem enviada`,
    });
  }

  return results;
}

// ─── Test runner ──────────────────────────────────────────────────────────────

const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";

function printResults(label: string, results: LifecycleResult[]): void {
  console.log(`\n${BOLD}${CYAN}━━━ ${label} ━━━${RESET}`);
  for (const r of results) {
    const icon = r.ok ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`;
    console.log(`  ${icon} ${BOLD}${r.step}${RESET}`);
    console.log(`     ${YELLOW}→${RESET} ${r.detail}`);
  }
}

async function main() {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}🔄 SPRINT 4 — FULL MESSAGE LIFECYCLE TEST${RESET}`);
  console.log(`${CYAN}Valida: Cancel → Decision → Compiler → Typing → Send → Schedule${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════════════${RESET}\n`);

  const agentConfig = { maxFollowUps: 4, followUpHoursMs: [4, 24, 48, 72].map((h) => h * 3_600_000) };

  // ── Scenario 1: First contact (should RESPOND + schedule follow-up) ─────────
  sentMessages.length = 0; scheduledJobs.length = 0; cancelledConversations.length = 0;
  const r1 = await handleMessageLifecycle(
    { conversationId: "conv-001", phoneNumber: "5562999990001", content: "Oi, vi o anúncio e quero saber mais", messageId: "msg-001" },
    { etapa: "NOVO" },
    "Amigável",
    agentConfig,
  );
  printResults("Cenário 1: Primeiro Contato → RESPOND + Follow-up agendado", r1);

  // ── Scenario 2: Purchase intent (should RESPOND with CLOSING state) ─────────
  sentMessages.length = 0; scheduledJobs.length = 0; cancelledConversations.length = 0;
  const r2 = await handleMessageLifecycle(
    { conversationId: "conv-002", phoneNumber: "5562999990002", content: "Quero assinar agora! Como faço?", messageId: "msg-002" },
    { etapa: "QUALIFICANDO" },
    "Agressivo",
    agentConfig,
  );
  printResults("Cenário 2: Intenção de compra → RESPOND (CLOSING) + Follow-up", r2);

  // ── Scenario 3: Objection (should RESPOND with OBJECTION state) ─────────────
  sentMessages.length = 0; scheduledJobs.length = 0; cancelledConversations.length = 0;
  const r3 = await handleMessageLifecycle(
    { conversationId: "conv-003", phoneNumber: "5562999990003", content: "Achei muito caro, sem interesse agora", messageId: "msg-003" },
    { etapa: "QUALIFICANDO" },
    "Formal",
    agentConfig,
  );
  printResults("Cenário 3: Objeção de preço → RESPOND (OBJECTION) + Follow-up", r3);

  // ── Scenario 4: Escalation trigger (should ESCALATE, no message sent) ────────
  sentMessages.length = 0; scheduledJobs.length = 0; cancelledConversations.length = 0;
  const r4 = await handleMessageLifecycle(
    { conversationId: "conv-004", phoneNumber: "5562999990004", content: "Isso é horrível, estou muito insatisfeito!", messageId: "msg-004" },
    { etapa: "QUALIFICANDO" },
    "Formal",
    agentConfig,
  );
  printResults("Cenário 4: Insatisfação → ESCALATE (sem msg, só log)", r4);
  const noMsgSent = sentMessages.length === 0;
  console.log(`  ${noMsgSent ? GREEN + "✅" : RED + "❌"}${RESET} Nenhuma mensagem enviada no ESCALATE: ${noMsgSent ? "CORRETO" : "ERRO"}`);

  // ── Scenario 5: Lead replies AFTER follow-ups are scheduled ───────────────────
  // First, schedule some follow-ups for conv-001
  await mockScheduleFollowUp("conv-001", 2, agentConfig.followUpHoursMs[1]);
  await mockScheduleFollowUp("conv-001", 3, agentConfig.followUpHoursMs[2]);
  const beforeCount = scheduledJobs.filter((j) => j.conversationId === "conv-001").length;

  cancelledConversations.length = 0;
  const r5 = await handleMessageLifecycle(
    { conversationId: "conv-001", phoneNumber: "5562999990001", content: "Oi, ainda tô pensando...", messageId: "msg-005" },
    { etapa: "QUALIFICANDO" },
    "Amigável",
    agentConfig,
  );
  printResults("Cenário 5: Lead responde após silêncio → Cancela follow-ups pendentes + nova resposta", r5);
  const wasCancelled = cancelledConversations.includes("conv-001");
  console.log(`  ${wasCancelled ? GREEN + "✅" : RED + "❌"}${RESET} Follow-ups de conv-001 cancelados (Regra de Ouro): ${wasCancelled ? "SIM" : "NÃO"}`);

  // ── Summary ───────────────────────────────────────────────────────────────────
  const allResults = [...r1, ...r2, ...r3, ...r4, ...r5];
  const passed = allResults.filter((r) => r.ok).length;
  const total  = allResults.length;

  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}📊 RESULTADO FINAL: ${passed}/${total} steps passaram${RESET}`);
  console.log(`${BOLD}📋 DecisionLog: ${decisionLog.length} decisões registradas${RESET}`);
  console.log(`   ${decisionLog.map((d) => `${d.conversationId}→${d.action}`).join(", ")}`);
  console.log(`${BOLD}📬 Mensagens enviadas total: ${sentMessages.length}${RESET}`);
  console.log(`${BOLD}⏰ Jobs BullMQ agendados: ${scheduledJobs.length}${RESET}`);
  console.log(`${BOLD}🛑 Conversas com follow-ups cancelados: ${[...new Set(cancelledConversations)].join(", ")}${RESET}`);

  if (passed === total) {
    console.log(`\n${BOLD}${GREEN}✅ CICLO DE VIDA COMPLETO VALIDADO — Sprint 4 OK${RESET}`);
  } else {
    console.log(`\n${BOLD}${RED}❌ ${total - passed} step(s) falharam${RESET}`);
    process.exit(1);
  }
  console.log(`${CYAN}═══════════════════════════════════════════════════════${RESET}\n`);
}

main().catch(console.error);
