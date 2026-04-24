# SYSTEM CONTEXT: AI Sales SaaS Platform

## 🎯 Project Vision
A high-performance SaaS platform that replaces manual sales efforts with autonomous AI agents capable of managing leads from the first contact to the closing, integrated via WhatsApp.

## 🚀 Core Features
- **WhatsApp Automation:** Seamless integration with Meta API for real-time communication.
- **AI Sales Agent:** Autonomous agents that act as sales representatives.
- **Lead Management:** Full CRM for tracking lead status and interaction history.
- **Follow-up Automation:** Intelligent rescheduling of messages to recover cold leads.
- **Product Broadcasting:** Ability to send bulk offers based on lead segments.
- **Sales Manager Reporting:** Analytics on conversion rates, agent performance, and lead states.

## 🛠 Tech Stack
- **Backend:** Node.js + TypeScript
- **Database:** PostgreSQL + Prisma ORM
- **Cache & Queue:** Redis + BullMQ (for follow-ups and delayed actions)
- **LLM Integration:** OpenAI / Anthropic (via Prompt Compiler pattern)
- **Interface:** WhatsApp API (Meta)

## 📏 Key Principles
- **Zero Hardcoding:** No AI behavior (prompts, rules, logic) is hardcoded in the backend.
- **Full Configurability:** All agent behaviors are managed via the SaaS dashboard.
- **Immutable Versioning:** AI configurations are versioned to prevent breaking active conversations.
- **Event-Driven:** The system reacts to events (Incoming Message → Decision → Action).

## 🤖 AI Responsibilities
- **Lead Qualification:** Identify if the lead is a fit for the product.
- **Sales Execution:** Drive the lead toward a specific goal (e.g., book a call, buy a product).
- **Objection Handling:** Use predefined rules to pivot and overcome resistance.
- **Follow-up:** Re-engage leads that stopped responding.
- **Escalation:** Detect when a human intervention is required and notify the manager.

## ⚠️ Constraints & Guardrails
- **Anti-Hallucination:** The agent must only use information provided in the knowledge base/config.
- **Frequency Control:** Respect strict follow-up limits to avoid being banned by WhatsApp.
- **Auditability:** Every single AI decision must be logged in the `DecisionLog` table.
- **State Integrity:** Leads must transition through the state machine logically.
