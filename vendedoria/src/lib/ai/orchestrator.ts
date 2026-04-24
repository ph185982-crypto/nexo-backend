import { makeDecision } from "./decision";
import { applyStateTransition, logStateTransition, etapaToState } from "./state-machine";
import { prisma } from "@/lib/prisma/client";

// ─── AI Orchestrator: Coordinates Decision Engine + State Machine ─────────────

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
}

/**
 * Orchestrate a complete AI decision flow:
 * 1. Load conversation history and current state
 * 2. Run Decision Engine
 * 3. Apply State Transitions
 * 4. Return structured result
 */
export async function orchestrateAIDecision(context: AIDecisionContext): Promise<AIDecisionResult | null> {
  try {
    // Load conversation and related data
    const conversation = await prisma.whatsappConversation.findUnique({
      where: { id: context.conversationId },
      include: {
        lead: true,
        provider: { include: { agent: true } },
        messages: {
          orderBy: { sentAt: "desc" },
          take: 30,
        },
      },
    });

    if (!conversation) {
      console.error("[Orchestrator] Conversation not found:", context.conversationId);
      return null;
    }

    // Get agent config
    const agentConfig = await prisma.agentConfig.findFirst();
    if (!agentConfig) {
      console.error("[Orchestrator] AgentConfig not found");
      return null;
    }

    // Prepare decision input
    const conversationHistory = conversation.messages
      .reverse() // newest last
      .map((msg) => ({
        role: (msg.role === "ASSISTANT" ? "assistant" : "user") as "user" | "assistant",
        content: msg.content,
        timestamp: msg.sentAt,
      }));

    const leadState = {
      etapa: conversation.etapa,
      midiaEnviada: conversation.midiaEnviada,
      localizacaoRecebida: conversation.localizacaoRecebida,
      foraAreaEntrega: conversation.foraAreaEntrega,
      produtoInteresse: conversation.produtoInteresse,
    };

    const agentConfigInput = {
      currentPrompt: agentConfig.currentPrompt,
      agentName: agentConfig.agentName,
      escalationThreshold: conversation.provider.agent?.escalationThreshold ?? 3,
      aiProvider: conversation.provider.agent?.aiProvider,
      aiModel: conversation.provider.agent?.aiModel,
    };

    // Run Decision Engine
    console.log(`[Orchestrator] Running Decision Engine for conv ${context.conversationId}`);
    const decision = await makeDecision(
      context.conversationId,
      conversationHistory,
      leadState,
      agentConfigInput,
      context.incomingMessage,
    );

    if (!decision) {
      console.error("[Orchestrator] Decision Engine failed");
      return null;
    }

    // Apply State Transition
    console.log(`[Orchestrator] Applying State Transition for action: ${decision.action}`);
    const transition = await applyStateTransition(context.conversationId, decision, leadState);

    let newEtapa: string | undefined;
    if (transition) {
      newEtapa = conversation.etapa; // Will be updated by applyStateTransition
      // Log the transition for audit trail
      await logStateTransition(
        context.conversationId,
        transition.from,
        transition.to,
        transition.reason,
        { decision: decision.action },
      ).catch((e) => console.error("[Orchestrator] Transition logging error:", e));
    }

    return {
      action: decision.action,
      targetState: decision.targetState,
      reasoning: decision.reasoning,
      newEtapa,
      stateTransitionApplied: !!transition,
    };
  } catch (error) {
    console.error("[Orchestrator] Error:", error);
    return null;
  }
}

/**
 * Simplified version: Just run Decision Engine without state transitions
 * Useful for testing or when you want fine-grained control
 */
export async function makeSimpleDecision(context: AIDecisionContext): Promise<AIDecisionResult | null> {
  try {
    const conversation = await prisma.whatsappConversation.findUnique({
      where: { id: context.conversationId },
      include: {
        messages: {
          orderBy: { sentAt: "desc" },
          take: 30,
        },
        provider: { include: { agent: true } },
      },
    });

    if (!conversation) return null;

    const agentConfig = await prisma.agentConfig.findFirst();
    if (!agentConfig) return null;

    const conversationHistory = conversation.messages
      .reverse()
      .map((msg) => ({
        role: (msg.role === "ASSISTANT" ? "assistant" : "user") as "user" | "assistant",
        content: msg.content,
        timestamp: msg.sentAt,
      }));

    const leadState = {
      etapa: conversation.etapa,
      midiaEnviada: conversation.midiaEnviada,
      localizacaoRecebida: conversation.localizacaoRecebida,
      foraAreaEntrega: conversation.foraAreaEntrega,
      produtoInteresse: conversation.produtoInteresse,
    };

    const agentConfigInput = {
      currentPrompt: agentConfig.currentPrompt,
      agentName: agentConfig.agentName,
      escalationThreshold: conversation.provider.agent?.escalationThreshold ?? 3,
      aiProvider: conversation.provider.agent?.aiProvider,
      aiModel: conversation.provider.agent?.aiModel,
    };

    const decision = await makeDecision(
      context.conversationId,
      conversationHistory,
      leadState,
      agentConfigInput,
      context.incomingMessage,
    );

    if (!decision) return null;

    return {
      action: decision.action,
      targetState: decision.targetState,
      reasoning: decision.reasoning,
      stateTransitionApplied: false,
    };
  } catch (error) {
    console.error("[SimpleDecision] Error:", error);
    return null;
  }
}
