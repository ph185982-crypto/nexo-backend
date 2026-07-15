# Whatsapp IA — Documentação Completa do Chat / Agente de Vendas

> Extração completa de todas as informações do sistema **"Whatsapp IA"** (VendedorIA),
> o agente autônomo de vendas via WhatsApp que faz parte do projeto `nexo-backend`.
> Todo o código vive em `vendedoria/` (Next.js 15 + GraphQL + Prisma).

---

## 1. Visão Geral

O **Whatsapp IA** é um agente de IA autônomo que atua como vendedor via WhatsApp,
gerenciando leads desde o primeiro contato até o fechamento do pedido. Ele:

- Recebe mensagens do cliente via webhook da **Meta WhatsApp Business API**.
- Detecta estado do lead, produto de interesse e dados de fechamento.
- Responde de forma humanizada (múltiplos balões, delays, "digitando…", check azul).
- Envia mídia (fotos/vídeos do produto) automaticamente.
- Escala para humano quando necessário.
- Agenda follow-ups automáticos para recuperar leads frios.
- Registra cada decisão para auditoria.

**Princípios de design** (ver `docs/ai-system-context.md`):
- **Zero Hardcoding**: comportamento (prompt, regras) configurado via dashboard, não no backend.
- **Full Configurability**: todo comportamento gerenciado no painel SaaS.
- **Immutable Versioning**: configs versionadas para não quebrar conversas ativas.
- **Event-Driven**: Mensagem recebida → Decisão → Ação.
- **Anti-Hallucination**: o agente só usa informação do catálogo/config.
- **Auditability**: toda decisão registrada em `DecisionLog`.

---

## 2. Stack Técnica

| Camada | Tecnologia |
|--------|-----------|
| Backend/Front | Next.js 15 (App Router + Turbopack) |
| API | GraphQL (Apollo Server 4 + Apollo Client 3) |
| Banco | PostgreSQL + Prisma ORM |
| Fila / Follow-up | Redis + BullMQ |
| LLM | Anthropic Claude / OpenAI GPT / Google Gemini (com fallback em cadeia) |
| Interface | WhatsApp Business API (Meta) |
| Auth | NextAuth.js v5 |
| Transcrição áudio | Whisper (via `transcription.ts`) |

---

## 3. Fluxo Ponta-a-Ponta

```
Cliente envia msg no WhatsApp
        │
        ▼
Meta envia POST → /api/webhooks/whatsapp   (route.ts)
        │  valida assinatura HMAC (META_WHATSAPP_APP_SECRET)
        │  transcreve áudio, parseia localização/contato/mídia
        │  cria/atualiza Lead + WhatsappConversation + WhatsappMessage
        │  cancela follow-ups pendentes
        ▼
runAIFlow()
        │
        ├─► orchestrateAIDecision()  (orchestrator.ts)
        │       → makeDecision() (decision.ts): RESPOND | FOLLOW_UP | WAIT | ESCALATE | CLOSE
        │       → applyStateTransition() (state-machine.ts)
        │       → grava DecisionLog
        │
        └─► processAIResponse()  (agent.ts)  ← núcleo (1827 linhas)
                → detecta estado do lead, escalação hard, fora de área, desinteresse
                → envia mídia forçada no 1º contato
                → monta prompt (base + runtime + sessão + catálogo)
                → chama LLM (llm-client.ts)
                → parseia JSON {mensagens, delays}
                → envia balões com "digitando…" e delays naturais
                → detecta [PASSAGEM] → notifica dono, cria pedido
                → agenda follow-up (BullMQ)
```

---

## 4. Componentes de Código

Todos os arquivos ficam em `vendedoria/src/`.

### 4.1 Webhook — `app/api/webhooks/whatsapp/route.ts`
- **GET**: verificação do webhook (`hub.verify_token` vs `META_WHATSAPP_VERIFY_TOKEN`).
- **POST**: recebe mensagens/status.
  - Valida assinatura `x-hub-signature-256` via HMAC-SHA256 (`verifySignature`).
  - Em erro, salva payload em `WebhookQueue` para retry em 30s e responde 200 (evita retry agressivo da Meta).
  - Normaliza tipos: `text, image, video, audio/voice, document, location, contacts`.
  - Áudio → baixa mídia e transcreve (`transcribeAudio`).
  - Localização → `[Localização recebida] lat:… lng:… | endereço:… | ponto:…`.
  - Deduplicação por `message.id` (unique constraint).
  - Cria `Lead` na coluna Kanban de entrada padrão (`isDefaultEntry`).
  - Desvia para handler de gerente se `isManagerNumber(phone)`.
  - Só aciona a IA se `agent.kind === "AI"` e `agent.status === "ACTIVE"`.

### 4.2 Núcleo do Agente — `lib/ai/agent.ts` (`processAIResponse`)
Arquivo principal (~1827 linhas). Responsabilidades:

- **Guards de entrada**: ignora se lead `ESCALATED`, `humanTakeover`, `foraAreaEntrega`,
  ou cortesia pós-confirmação.
- **`detectLeadState()`**: classifica em `curioso | interessado | quente | frio` +
  urgência `baixa | media | alta` por regex na mensagem.
- **`detectHardEscalation()`**: escalação garantida (independente do LLM) por:
  1. pedido explícito de humano ("falar com o Pedro/atendente…");
  2. ameaça legal (Procon, processo, Reclame Aqui…);
  3. raiva persistente (3+ das últimas 4 msgs agressivas);
  4. problema pós-venda após pedido fechado (`[PASSAGEM]` no histórico).
  Objeção de preço **nunca** escala.
- **`detectDesinteresse()`** (Anti-Zumbi): opt-out ("não quero", "pode parar", "me remove") → marca lead `BLOCKED`/`PERDIDO`.
- **`detectForaDeArea()`**: só entrega em Goiânia e região; detecta cidade/estado fora + negação.
- **`extractCollectedData()`**: extrai localização, endereço, pagamento, horário, nome, CEP do histórico — para **não perguntar de novo**.
- **Envio forçado de mídia no 1º contato**: fotos + vídeo do produto detectado, antes da IA responder.
- **`buildRuntimeContext()`**: injeta no prompt hora de SP, saudação, expediente, estado do lead, dados coletados, tentativas de objeção, flags de mídia e o **formato de resposta obrigatório em JSON**.
- **`buildSessaoContext()`**: dados de sessão (motivo, CEP, endereço, nome) + regra de fechamento (CEP só após confirmação explícita).
- **Passagem automática (`[PASSAGEM]`)**: quando os 4 dados (endereço, horário, pagamento, nome) estão completos → notifica dono e cria o pedido.
- **Follow-up**: intervalos `[4h, 24h, 48h, 72h]` via BullMQ.

**Formato de resposta obrigatório do LLM:**
```json
{"mensagens": ["balão 1", "balão 2", "[FOTO_SLUG]", "balão 3"], "delays": [0, 1200, 600, 1500]}
```
- Cada balão = 1 frase curta (1-2 linhas); delays em ms (600-2000).
- Flags de mídia `[FOTO_SLUG]` / `[VIDEO_SLUG]` sozinhas no array.
- Proibido "Claro!", "Ótimo!", "Prezado" — fala como pessoa real.

### 4.3 Orquestrador — `lib/ai/orchestrator.ts`
Coordena Decision Engine + State Machine. Carrega conversa + histórico (30 msgs), roda
`makeDecision()`, aplica transição de estado e loga. Retorna `AIDecisionResult`.

### 4.4 Motor de Decisão — `lib/ai/decision.ts`
- **`callLLMRouter()`**: pergunta ao LLM a próxima ação (`RESPOND | FOLLOW_UP | WAIT | ESCALATE | CLOSE`) em JSON.
- **`makeFallbackDecision()`**: regras determinísticas se o LLM falhar.
- **`makeDecision()`**: tenta LLM → fallback → grava `DecisionLog`.
- **`decisionService`**: versão síncrona baseada em regras usada por `agent.ts`.

### 4.5 Máquina de Estados — `lib/ai/state-machine.ts`
Estados internos: `NEW → ENGAGED → OBJECTION/NEGOTIATION → CLOSING → WON | LOST`
(WON/LOST terminais). `VALID_TRANSITIONS` valida cada transição.
Mapeamento `etapa` (DB) ↔ `LeadState`:

| etapa (DB) | LeadState |
|-----------|-----------|
| NOVO | NEW |
| PRODUTO_IDENTIFICADO / MIDIA_ENVIADA / QUALIFICANDO | ENGAGED |
| NEGOCIANDO / COLETANDO_DADOS | NEGOTIATION |
| PEDIDO_CONFIRMADO | CLOSING/WON |
| PERDIDO | LOST |

### 4.6 Cliente LLM — `lib/ai/llm-client.ts`
`callLLM()` com fallback em cadeia:
1. Provider configurado (`ANTHROPIC` / `OPENAI` / `GOOGLE`).
2. Fallback: **Anthropic** (`claude-haiku-4-5-20251001`) → **Gemini** (`gemini-2.0-flash-lite`) → **OpenAI** (`gpt-4o-mini`).

Defaults: `maxTokens 400`, `temperature 0.85`.

### 4.7 Responder — `lib/ai/responder.ts`
Recebe decisão `RESPOND`, chama o LLM com o prompt compilado, parseia JSON,
mostra "digitando…" (delay proporcional ao tamanho da msg), envia balões com pausa de 1s,
persiste como `role: ASSISTANT`.

### 4.8 Outros arquivos em `lib/ai/`
| Arquivo | Função |
|---------|--------|
| `prompt-compiler.ts` | Compila prompt em camadas (persona, estratégia, restrições, objeções, catálogo, histórico) |
| `product-sourcing.ts` | Detecta produto na msg e busca dados reais |
| `contexto-produtos.ts` | Formata catálogo ativo para o prompt |
| `buscar-produto.ts` | Busca produto por nome/slug |
| `sessao-nacional.ts` | Sessão do fluxo de venda nacional |
| `sessao-prospeccao.ts` | Sessão do fluxo de prospecção B2B |
| `deteccao-nacional.ts` | Detecta fluxo de venda nacional |
| `transcription.ts` | Transcrição de áudio (Whisper) |

### 4.9 WhatsApp API — `lib/whatsapp/`
- **`send.ts`**: `sendWhatsAppMessage`, `sendWhatsAppImage`, `sendWhatsAppVideo`,
  `sendTypingIndicator`, `markWhatsAppMessageRead`, `simulateTypingDelay`, `normalizeBrazilianNumber`.
- **`media.ts`**: `getMediaUrl`, `downloadMedia` (baixa mídia inbound da Meta).

### 4.10 Interface do Chat — `app/crm/agents/chat/[accountId]/page.tsx`
UI estilo WhatsApp (React + Apollo):
- Painel esquerdo: lista de conversas (busca, tags, badge de não-lidas, polling 5s).
- Painel direito: bolhas de mensagem (verde para IA, branca para cliente), check azul de leitura,
  render especial para localização (link do Google Maps), polling 3s.
- Input de envio com mutation `sendWhatsappMessage`.

---

## 5. Modelos de Banco (Prisma) Relevantes

| Model | Papel no Whatsapp IA |
|-------|---------------------|
| `WhatsappProviderConfig` | Conexão com número Meta (token, phoneNumberId, WABA) |
| `Agent` | Config do agente: `kind` (AI/HUMAN), `status`, `systemPrompt`, `aiProvider`, `aiModel`, `escalationThreshold`, `sandboxMode` |
| `AgentConfigVersion` | Histórico versionado de config (prompt, nível de venda, emoji, objeções, restrições, follow-up) |
| `AgentScriptVersion` | Histórico de scripts do agente |
| `AgentConfig` | Config global legada (singleton): nome "Pedro", bastão, expediente, área de entrega, auto-passagem, auto-mídia |
| `AiConfig` | Config por organização: emoji, reticências, nível de venda, tom de voz, arquétipo, objetivo, urgência, matriz de objeções, restrições, follow-up |
| `WhatsappConversation` | Estado da conversa: `etapa`, `produtoInteresse`, `midiaEnviada`, `localizacaoRecebida`, `foraAreaEntrega`, `humanTakeover`, dados de fechamento, sessões (JSON) |
| `WhatsappMessage` | Mensagens: `content`, `type`, `role`, `status`, `mediaUrl` |
| `ConversationFollowUp` | Follow-up: `step` (1=4h…4=72h), `status`, `nextSendAt` |
| `Lead` | Lead: `status` (OPEN/ESCALATED/CLOSED/BLOCKED), origem, coluna Kanban |
| `LeadEscalation` | Registro de escalação para humano |
| `DecisionLog` | Auditoria de cada decisão da IA |
| `Product` | Catálogo: preço, parcelas, especificações, imagens, vídeo |
| `OwnerNotification` | Notificações ao dono (ORDER / ESCALATION / OPT_OUT) |
| `WebhookQueue` | Fila de retry de webhooks que falharam |
| `KanbanColumn` | Colunas do funil (CUSTOM/ESCALATED/LOST/TRIAGE/JUNK) |

### Estados da conversa (`etapa`)
`NOVO → PRODUTO_IDENTIFICADO → MIDIA_ENVIADA → QUALIFICANDO → NEGOCIANDO → COLETANDO_DADOS → PEDIDO_CONFIRMADO → PERDIDO`

### Parâmetros de config (AiConfig / AgentConfigVersion)
- `nivelVenda`: `leve | medio | agressivo`
- `tomDeVoz`: `sincero | agressivo | consultivo`
- `objetivoVenda`: `fechar_venda | gerar_lead | qualificar`
- `nivelUrgencia`: 1-5
- `usarEmoji`, `usarReticencias`: bool
- `matrizObjecoes`, `restricoes`: JSON
- `followUpIntervalos`: `[4,24,48,72]` (horas), `followUpMaxTentativas`: 4

---

## 6. Regras de Negócio Embutidas

- **Área de entrega**: apenas Goiânia e região metropolitana (Aparecida, Senador Canedo, Trindade, Goianira, Nerópolis, Hidrolândia, Anápolis…).
- **Expediente**: Seg-Sex 9h-18h, Sáb 8h-13h (fuso `America/Sao_Paulo`). Fora disso, oferece agendar próximo dia útil.
- **Saudação** por horário real de Brasília (bom dia / boa tarde / boa noite).
- **Dono / bastão**: número `5562984465388` (Pedro) — recebe escalações, passagens e erros críticos.
- **Follow-up**: 4 tentativas em 4h / 24h / 48h / 72h; cancelado quando o cliente responde.
- **Objeção de preço**: até 5 tentativas de quebra, **nunca** escala por preço.
- **Fechamento**: CEP/endereço só depois de confirmação explícita de compra.
- **Passagem** (`[PASSAGEM]`): disparada quando endereço + horário + pagamento + nome estão coletados.

---

## 7. Variáveis de Ambiente

```env
# Banco
DATABASE_URL="postgresql://…"

# NextAuth
NEXTAUTH_URL="https://seu-dominio.com"
NEXTAUTH_SECRET="…"

# WhatsApp Business API (Meta)
META_WHATSAPP_VERIFY_TOKEN="…"      # verificação do webhook
META_WHATSAPP_ACCESS_TOKEN="EAAxxxx…"
META_WHATSAPP_APP_SECRET="…"        # validação de assinatura HMAC

# LLM (pelo menos um)
ANTHROPIC_API_KEY="sk-ant-…"
OPENAI_API_KEY="sk-…"
GOOGLE_AI_API_KEY="…"

# Google Calendar (agendamentos)
GOOGLE_CLIENT_ID="…"
GOOGLE_CLIENT_SECRET="…"

# Opcionais
OWNER_WHATSAPP_NUMBER="5562984465388"
RENDER_EXTERNAL_URL / NEXT_PUBLIC_APP_URL   # URL base pública (mídia)
```

### Configuração do Webhook na Meta Business
1. URL: `https://seu-dominio.com/api/webhooks/whatsapp`
2. Token de verificação: valor de `META_WHATSAPP_VERIFY_TOKEN`
3. Campos assinados: `messages`

---

## 8. Onde Configurar o Comportamento (Painel)

- `/crm/agent` — prompt e comportamento da IA.
- `/crm/configure-agent` — assistente de configuração.
- `/crm/agents/chat/[accountId]` — chat/monitor de conversas WhatsApp.
- `/crm/agent-config/chat` e `/crm/agent/chat` (API) — configuração conversacional.

---

## 9. Referências no Repositório

- `docs/ai-system-context.md` — princípios e responsabilidades da IA.
- `docs/architecture.md`, `docs/roadmap.md`, `docs/sprint3-compiler.md`.
- `vendedoria/README.md` — setup do projeto.
- `PROMPT_AGENTE_SETUP.md` — prompt de setup do agente.
- Núcleo: `vendedoria/src/lib/ai/` e `vendedoria/src/lib/whatsapp/`.
</content>
</invoke>
