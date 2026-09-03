import type { CompiledPrompt } from "./prompt-compiler";

// ─── AI Orchestrator types ─────────────────────────────────────
// (O motor de decisão assíncrono baseado em LLM que este arquivo orquestrava —
// makeDecision/applyStateTransition/logStateTransition — foi removido junto
// com o resto do antigo fluxo síncrono; ver decision.ts. Só os tipos abaixo
// seguem em uso, por responder.ts.)

export interface AIDecisionContext {
  conversationId: string;
  incomingMessage: string;
  agentId?: string;
}

export interface AIDecisionResult {
  action: string;
  targetState: string | null;
  reasoning: string;
  newEtapa?: string;
  stateTransitionApplied: boolean;
  compiledPrompt?: CompiledPrompt;
}
