import { prisma } from "@/lib/prisma/client";

// ─── Lead State Machine: Controls state transitions based on decisions ───────

type LeadState = "NEW" | "ENGAGED" | "OBJECTION" | "NEGOTIATION" | "CLOSING" | "WON" | "LOST";

type TransitionReason =
  | "INITIAL_CONTACT"
  | "PRODUCT_IDENTIFIED"
  | "MEDIA_SENT"
  | "LOCATION_RECEIVED"
  | "OBJECTION_DETECTED"
  | "NEGOTIATING"
  | "READY_FOR_CLOSING"
  | "SALES_COMPLETED"
  | "LOST_INTEREST"
  | "OUT_OF_DELIVERY_AREA"
  | "NO_RESPONSE"
  | "ESCALATED";

interface StateTransition {
  from: LeadState;
  to: LeadState;
  reason: TransitionReason;
  timestamp: Date;
}

// ─── Define valid state transitions ──────────────────────────────────────────

const VALID_TRANSITIONS: Record<LeadState, LeadState[]> = {
  "NEW": ["ENGAGED", "LOST"],
  "ENGAGED": ["OBJECTION", "NEGOTIATION", "CLOSING", "LOST"],
  "OBJECTION": ["NEGOTIATION", "ENGAGED", "LOST"],
  "NEGOTIATION": ["CLOSING", "LOST"],
  "CLOSING": ["WON", "LOST"],
  "WON": ["WON"], // terminal state, stays WON
  "LOST": ["LOST"], // terminal state, stays LOST
};

// ─── Map decision outcomes to state transitions ───────────────────────────────

export async function applyStateTransition(
  conversationId: string,
  decision: {
    action: string;
    targetState: string | null;
  },
  conversationState: {
    etapa: string;
    midiaEnviada: boolean;
    localizacaoRecebida: boolean;
    foraAreaEntrega: boolean;
    produtoInteresse: string | null;
  },
): Promise<StateTransition | null> {
  try {
    const conversation = await prisma.whatsappConversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });

    if (!conversation || !conversation.lead) {
      console.warn("[StateMachine] Conversation or lead not found");
      return null;
    }

    let newState: LeadState | null = null;
    let reason: TransitionReason | null = null;

    // Determine new state based on decision
    switch (decision.action) {
      case "RESPOND":
        // If we're responding, check what we learned
        if (conversationState.produtoInteresse && !conversationState.midiaEnviada) {
          newState = "ENGAGED";
          reason = "PRODUCT_IDENTIFIED";
        } else if (conversationState.localizacaoRecebida && !conversationState.midiaEnviada) {
          newState = "ENGAGED";
          reason = "LOCATION_RECEIVED";
        }
        break;

      case "FOLLOW_UP":
        // Follow-up usually means waiting for response, but if we're following up,
        // it might be because they're cold/not responding
        newState = decision.targetState as LeadState | null;
        reason = "NO_RESPONSE";
        break;

      case "ESCALATE":
        // Escalation doesn't change lead etapa but might change kanban status
        // Lead status is handled separately in handleEscalation()
        return null; // Don't process state machine for escalations

      case "CLOSE":
        // Close decision means either WON or LOST
        if (conversationState.foraAreaEntrega) {
          newState = "LOST";
          reason = "OUT_OF_DELIVERY_AREA";
        } else {
          newState = decision.targetState as LeadState | null;
          reason = "LOST_INTEREST";
        }
        break;

      case "WAIT":
        // WAIT means stay in current state
        return null;

      default:
        return null;
    }

    if (!newState || !reason) {
      return null;
    }

    // Validate transition
    const currentState = (conversation.etapa === "PEDIDO_CONFIRMADO" ? "CLOSING" : "ENGAGED") as LeadState;

    if (!isValidTransition(currentState, newState)) {
      console.log(
        `[StateMachine] Invalid transition: ${currentState} -> ${newState} (reason: ${reason}). Skipping.`
      );
      return null;
    }

    // Apply transition
    const transitionRecord = {
      from: currentState,
      to: newState,
      reason,
      timestamp: new Date(),
    };

    // Update conversation etapa based on new state
    const newEtapa = stateToEtapa(newState);
    await prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { etapa: newEtapa, updatedAt: new Date() },
    });

    console.log(`[StateMachine] Transition: ${currentState} -> ${newState} (${reason}) for conv ${conversationId}`);

    return transitionRecord;
  } catch (error) {
    console.error("[StateMachine] Error applying state transition:", error);
    return null;
  }
}

// ─── Helper: Check if transition is valid ─────────────────────────────────────

function isValidTransition(from: LeadState, to: LeadState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Helper: Map internal state to conversation etapa ──────────────────────────

function stateToEtapa(state: LeadState): string {
  const mapping: Record<LeadState, string> = {
    "NEW": "NOVO",
    "ENGAGED": "QUALIFICANDO",
    "OBJECTION": "NEGOCIANDO",
    "NEGOTIATION": "NEGOCIANDO",
    "CLOSING": "PEDIDO_CONFIRMADO",
    "WON": "PEDIDO_CONFIRMADO",
    "LOST": "PERDIDO",
  };
  return mapping[state] ?? "NOVO";
}

// ─── Helper: Map conversation etapa to internal state ──────────────────────────

export function etapaToState(etapa: string): LeadState {
  const mapping: Record<string, LeadState> = {
    "NOVO": "NEW",
    "PRODUTO_IDENTIFICADO": "ENGAGED",
    "MIDIA_ENVIADA": "ENGAGED",
    "QUALIFICANDO": "ENGAGED",
    "NEGOCIANDO": "NEGOTIATION",
    "COLETANDO_DADOS": "NEGOTIATION",
    "PEDIDO_CONFIRMADO": "CLOSING",
    "PERDIDO": "LOST",
  };
  return mapping[etapa] ?? "NEW";
}

// ─── Helper: Get all possible next states from current state ──────────────────

export function getPossibleNextStates(currentState: LeadState): LeadState[] {
  return VALID_TRANSITIONS[currentState] ?? [];
}

// ─── Helper: Log state transitions (audit trail) ────────────────────────────

export async function logStateTransition(
  conversationId: string,
  from: LeadState,
  to: LeadState,
  reason: TransitionReason,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    // Could create a separate StateTransitionLog table for full audit trail
    console.log(
      `[StateTransition] Conv ${conversationId} | ${from} -> ${to} | ${reason}`,
      metadata ? JSON.stringify(metadata) : ""
    );
  } catch (error) {
    console.error("[StateTransition] Logging error:", error);
  }
}
