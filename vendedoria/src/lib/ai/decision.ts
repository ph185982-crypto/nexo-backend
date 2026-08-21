// ─── Decision Service: guarda-corpo síncrono usado por processAIResponse ──────
// (O antigo motor de decisão assíncrono baseado em LLM — makeDecision/
// callLLMRouter/DecisionLog — foi removido: seu resultado nunca era usado
// para nada além de log, e o log em si nunca era lido de volta.)

interface HardEscalationResult {
  shouldEscalate: boolean;
}

interface DecisionCtx {
  conversationId: string;
  humanTakeover?: boolean;
  isOptOut?: boolean;
  hardEscalation?: boolean | HardEscalationResult;
  foraAreaEntrega?: boolean;
  hasIntentoBuy?: boolean;
  isFirstInteraction?: boolean;
  allDataCollected?: boolean;
}

interface SimpleDecision {
  action: "RESPOND" | "WAIT" | "CLOSE" | "ESCALATE";
  reason: string;
}

export const decisionService = {
  decide(ctx: DecisionCtx): SimpleDecision {
    if (ctx.humanTakeover) return { action: "WAIT", reason: "human takeover ativo" };
    if (ctx.isOptOut)      return { action: "CLOSE", reason: "cliente optou por sair" };
    const isEscalation = ctx.hardEscalation && (typeof ctx.hardEscalation === "boolean" ? ctx.hardEscalation : ctx.hardEscalation.shouldEscalate);
    if (isEscalation) return { action: "ESCALATE", reason: "escalação forçada" };
    if (ctx.foraAreaEntrega) return { action: "RESPOND", reason: "fora área — informar e encerrar" };
    return { action: "RESPOND", reason: "fluxo normal" };
  },
  log(ctx: DecisionCtx, decision: SimpleDecision): Promise<void> {
    console.log(`[DecisionService] conv=${ctx.conversationId} action=${decision.action} reason=${decision.reason}`);
    return Promise.resolve();
  },
};
