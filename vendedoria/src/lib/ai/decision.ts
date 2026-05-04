import { prisma } from "@/lib/prisma/client";

export type DecisionAction = "RESPOND" | "FOLLOW_UP" | "ESCALATE" | "WAIT" | "CLOSE";

export interface HardEscalationSignal {
  shouldEscalate: boolean;
  reason: string;
}

export interface DecisionContext {
  conversationId: string;
  userMessage: string;
  messageCount: number;
  leadStatus: string;
  etapa: string;
  humanTakeover: boolean;
  foraAreaEntrega: boolean;
  isOptOut: boolean;
  hardEscalation: HardEscalationSignal;
  hasIntentoBuy: boolean;
  isFirstInteraction: boolean;
  allDataCollected: boolean;
}

export interface DecisionResult {
  action: DecisionAction;
  reason: string;
  metadata?: Record<string, unknown>;
}

export class DecisionService {
  decide(ctx: DecisionContext): DecisionResult {
    // Hard exits — never respond
    if (ctx.humanTakeover) {
      return { action: "WAIT", reason: "Human takeover ativo — IA pausada" };
    }

    if (ctx.isOptOut) {
      return { action: "CLOSE", reason: "Cliente optou por não ser contactado" };
    }

    if (ctx.foraAreaEntrega) {
      return { action: "CLOSE", reason: "Fora da área de entrega" };
    }

    if (ctx.leadStatus === "ESCALATED") {
      return { action: "WAIT", reason: "Lead já escalado — aguardando humano" };
    }

    if (ctx.leadStatus === "BLOCKED") {
      return { action: "CLOSE", reason: "Lead bloqueado" };
    }

    // Pedido confirmado — só cortesias limitadas
    if (ctx.etapa === "PEDIDO_CONFIRMADO") {
      return { action: "RESPOND", reason: "Pós-confirmação: cortesia limitada", metadata: { postConfirmation: true } };
    }

    // Escalação forçada pelo código (hard triggers)
    if (ctx.hardEscalation.shouldEscalate && !ctx.hasIntentoBuy) {
      return { action: "ESCALATE", reason: ctx.hardEscalation.reason };
    }

    // Todos os dados coletados → fechar pedido
    if (ctx.allDataCollected) {
      return { action: "CLOSE", reason: "Todos os dados coletados — passagem executada", metadata: { passagem: true } };
    }

    // Conversa ativa — IA responde
    return {
      action: "RESPOND",
      reason: ctx.isFirstInteraction
        ? "Primeiro contato — apresentação e qualificação"
        : `Mensagem ${ctx.messageCount} — etapa ${ctx.etapa}`,
    };
  }

  async log(ctx: DecisionContext, result: DecisionResult): Promise<void> {
    try {
      await prisma.decisionLog.create({
        data: {
          conversationId: ctx.conversationId,
          action: result.action,
          reason: result.reason,
          metadata: result.metadata ? JSON.parse(JSON.stringify(result.metadata)) : undefined,
        },
      });
    } catch (err) {
      console.error("[DecisionService] log error:", err);
    }
  }
}

export const decisionService = new DecisionService();
