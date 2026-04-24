# TECHNICAL ROADMAP: AI SALES SDR + CRM

## 🏁 Phase 1: The Brain (Core Intelligence)
- [ ] **Sprint 2: Decision Engine**
    - Implement LLM Router to decide between: RESPOND, FOLLOW_UP, ESCALATE, WAIT, CLOSE.
    - Implement State Transition logic (e.g., NEW -> ENGAGED).
    - Create `DecisionLog` entries for every action.
- [ ] **Sprint 3: Dynamic Prompt Compiler**
    - Implement modular assembly of prompts based on `AgentConfigVersion`.
    - Integration of `ObjectionRules` based on keyword triggers.
    - Context injection (Last N messages + Lead State).

## 🔄 Phase 2: Automation & Engagement
- [ ] **Sprint 4: Intelligent Follow-up System**
    - BullMQ integration for delayed jobs.
    - "Auto-cancel" logic: Cancel all pending follow-ups when a lead responds.
    - NLP Date Parsing: Detect "call me tomorrow" or "talk at 6pm" and schedule specifically.
- [ ] **Sprint 5: WhatsApp Advanced Integration**
    - Implement "Typing..." indicator (UX).
    - Phone Normalization Utility (Standardize to 55 + DDD + Number).
    - Media Handling: Logic to save and retrieve images, videos, and locations.
    - Native Location format support (clickable links).

## 📊 Phase 3: Management & Scale
- [ ] **Sprint 6: Manager Mode (Admin Access)**
    - Identification of Admin Number (62984465388).
    - Command Processor: "Quantas vendas hoje?", "Resumo do dia".
    - Scheduled Reporting: Auto-send daily reports at 13h and 18h.
- [ ] **Sprint 7: Product Broadcasting & Lead Outbound**
    - Daily Product List generator (Image + Price + CTA).
    - Dashboard-driven bulk messaging to existing leads.
    - Rate limiting to prevent WhatsApp bans.

## 🖥 Phase 4: Dashboard & UX
- [ ] **Sprint 8: Advanced AI Config Dashboard**
    - UI for Personality, Tone, and Sales Strategy.
    - Visual Objection Rule builder.
    - Follow-up timing/frequency sliders.
- [ ] **Sprint 9: Media Gallery & CRM View**
    - Integrated viewer for lead media (photos/videos) inside the SaaS.
    - Lead state kanban board.
