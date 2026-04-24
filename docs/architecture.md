# TECHNICAL ARCHITECTURE

## 🗄 Database Design
- **Relational Model:** PostgreSQL using Prisma.
- **Core Entities:**
    - `Agent` → `AgentConfig` → `AgentConfigVersion` (One-to-Many).
    - `Lead` → `Conversation` → `Message` (One-to-Many).
    - `AgentConfigVersion` → `PromptBlock` / `ObjectionRule` / `FollowUpSetting`.
- **Indexing:** High-performance indexes on `phone`, `orgId`, and `conversationId`.

## 🧠 Decision Engine (The Brain)
The system uses a **Router Pattern** to decide the next action:
1. **Input:** `Conversation History` + `Current Lead State` + `Active AgentConfig`.
2. **Reasoning:** The LLM analyzes the intent and determines the next action.
3. **Action Output:** A structured JSON returning:
    - `action`: (RESPOND | FOLLOW_UP | ESCALATE | WAIT | CLOSE)
    - `target_state`: The next state for the lead (e.g., ENGAGED → OBJECTION).
    - `reasoning`: Chain-of-thought explanation for the decision.

## 🏗 Prompt Compiler (The Generator)
Instead of static prompts, the system "compiles" the prompt at runtime:
- **Layer 1 (Persona):** Personality and tone from `AgentConfigVersion`.
- **Layer 2 (Strategy):** Current sales goal and approach.
- **Layer 3 (Constraints):** "What NOT to do" list.
- **Layer 4 (Context):** Relevant `ObjectionRules` triggered by keywords.
- **Layer 5 (History):** The last N messages of the conversation.

## 🔄 Lead State Machine
The lead moves through a linear/conditional flow:
`NEW` → `ENGAGED` → `OBJECTION` → `NEGOTIATION` → `CLOSING` → `WON/LOST`.
- Each state modifies the prompt blocks injected by the Compiler.

## 🕒 Follow-up System (Event-Driven)
- **Queue:** BullMQ handles delayed jobs.
- **Logic:**
    - If `DecisionEngine` returns `FOLLOW_UP`, a job is scheduled for X hours.
    - **Cancellation:** Any new `IncomingMessage` event immediately cancels all pending `ScheduledAction` jobs for that lead.
    - **Retry:** Executes based on the `FollowUpSetting` retry logic.

## 📡 Communication Flow
`WhatsApp Webhook` → `State Manager` → `Decision Engine` → `Prompt Compiler` → `LLM` → `WhatsApp API`.
