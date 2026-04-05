import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage, sendWhatsAppImage, sendWhatsAppVideo, simulateTypingDelay } from "@/lib/whatsapp/send";

const FOLLOWUP_INTERVALS_MS = [
  4  * 60 * 60 * 1000,  // step 1 — 4h
  24 * 60 * 60 * 1000,  // step 2 — 24h
  48 * 60 * 60 * 1000,  // step 3 — 48h
  72 * 60 * 60 * 1000,  // step 4 — 72h
];

// Progressive delays between split messages (ms)
const SEND_DELAYS_MS = [0, 1500, 2000, 2500];

interface AgentConfig {
  id: string;
  systemPrompt?: string | null;
  kind: string;
  status: string;
  aiProvider?: string | null;
  aiModel?: string | null;
  sandboxMode?: boolean;
}

interface LeadState {
  tipo: "curioso" | "interessado" | "quente" | "frio";
  urgencia: "baixa" | "media" | "alta";
}

// ── ETAPA 1 — Motor de Inteligência ─────────────────────────────────────────
function detectLeadState(message: string): LeadState {
  const msg = message.toLowerCase();

  if (/quero\b|como\s+compra|entrega\s+quando|pronta\s+entrega|vou\s+comprar|quero\s+comprar|fechar|confirmar|fazer\s+pedido/.test(msg)) {
    return { tipo: "quente", urgencia: "alta" };
  }
  if (/quanto\s+custa|qual\s+o\s+preço|qual\s+o\s+valor|preço|valor|como\s+funciona|tem\s+disponível|tem\s+estoque|parcel/.test(msg)) {
    return { tipo: "interessado", urgencia: "media" };
  }
  if (/depois|vou\s+ver|talvez|não\s+sei|to\s+vendo|tô\s+vendo|ta\s+caro|tá\s+caro|muito\s+caro/.test(msg)) {
    return { tipo: "frio", urgencia: "baixa" };
  }
  return { tipo: "curioso", urgencia: "baixa" };
}

// ── ETAPA 2 — Engine de Resposta Humana ─────────────────────────────────────
function splitMessages(response: string): string[] {
  return response
    .split("||")
    .map((m) => m.trim())
    .filter(Boolean);
}

// Build context block injected into system prompt at runtime
function buildRuntimeContext(
  leadState: LeadState,
  isFirstInteraction: boolean,
  aiConfig: { usarEmoji: boolean; usarReticencias: boolean; nivelVenda: string } | null,
  hour: number
): string {
  const period = hour < 12 ? "manhã" : hour < 18 ? "tarde" : "noite";
  const greeting = hour < 12 ? "bom dia" : hour < 18 ? "boa tarde" : "boa noite";

  const nivelInstructions: Record<string, string> = {
    leve: "Seja leve — responda e deixe o cliente conduzir. Não force venda.",
    medio: "Conduza com naturalidade. Após responder, faça uma pergunta curta ou sugira próximo passo.",
    agressivo: "Conduza ativamente para o fechamento. Use gatilhos de urgência com naturalidade.",
  };

  const nivel = aiConfig?.nivelVenda ?? "medio";
  const emoji = aiConfig?.usarEmoji !== false;
  const reticencias = aiConfig?.usarReticencias !== false;

  const lines = [
    `\n\n--- CONTEXTO RUNTIME ---`,
    `Horário atual: ${period} (${hour}h)`,
    `Estado do lead: ${leadState.tipo} | Urgência: ${leadState.urgencia}`,
    `Primeira interação: ${isFirstInteraction ? "SIM" : "NÃO"}`,
    ``,
    `CONFIGURAÇÃO DE VENDA:`,
    nivelInstructions[nivel] ?? nivelInstructions.medio,
    `Usar emojis: ${emoji ? "SIM (use com moderação, 1 por mensagem)" : "NÃO"}`,
    `Usar reticências (...): ${reticencias ? "SIM (ocasionalmente)" : "NÃO"}`,
    ``,
    `COMPORTAMENTO AGORA:`,
  ];

  // ETAPA 3 — Comportamento por tipo
  if (isFirstInteraction) {
    lines.push(`→ PRIMEIRA MENSAGEM: cumprimente ("${greeting}, tudo bem?"), depois "me chamo Pedro", "falo da Nexo", "vou te ajudar aqui ${emoji ? "👍" : ""}".`);
    lines.push(`→ Depois da saudação, responda o que o cliente perguntou.`);
  } else if (leadState.tipo === "quente") {
    lines.push(`→ Lead QUENTE: vá direto ao fechamento. "me manda sua localização 📍" e "e o endereço certinho".`);
  } else if (leadState.tipo === "interessado") {
    lines.push(`→ Lead INTERESSADO: informe o preço, reforce "vc paga só na entrega ${emoji ? "👍" : ""}", pergunte "quer que eu já separe uma?"`);
  } else if (leadState.tipo === "frio") {
    lines.push(`→ Lead FRIO: reengaje suavemente. "essa compensa viu..." ou "últimas unidades que chegou". Não force.`);
  } else {
    lines.push(`→ Lead CURIOSO: responda com naturalidade. "tenho sim${emoji ? " 👍" : ""}", "essa é bem forte${reticencias ? "..." : ""}", "cliente pega bastante".`);
  }

  lines.push(``, `FORMATO OBRIGATÓRIO DE RESPOSTA:`);
  lines.push(`Separe SEMPRE as mensagens com || entre elas. Cada parte = 1 linha, 1 ideia.`);
  lines.push(`ERRADO: "Tenho sim. Essa é bem forte. Pagamento na entrega."`);
  lines.push(`CERTO: "tenho sim${emoji ? " 👍" : ""} || essa é bem forte${reticencias ? "..." : ""} || pagamento só na entrega"`);
  lines.push(`--- FIM DO CONTEXTO ---`);

  return lines.join("\n");
}

const DEFAULT_SYSTEM_PROMPT = `Você é Pedro, vendedor da Nexo Brasil. Ferramentas profissionais, entrega em Goiânia e região, Goiás.

REGRA MAIS IMPORTANTE:
Você NÃO pode parecer IA. Fala igual vendedor real de WhatsApp.

ESTILO:
- Máximo 1 linha por mensagem
- Linguagem simples (vc, ta, né)
- Pode errar leve
- Não repetir padrão de frase

PROIBIDO:
- textos longos
- parecer robô
- repetir "sou assistente virtual"
- falar demais

NEGÓCIO:
- Pagamento SOMENTE na entrega — nunca antes
- Entrega em Goiânia e região
- Emite nota fiscal, 1 ano de garantia

FECHAMENTO — quando tiver nome, endereço, bairro, CEP, telefone, produto e pagamento:
[PASSAGEM]{"nome":"...","endereco":"...","cep":"...","bairro":"...","telefone":"...","produtos":[{"nome":"...","qtd":1}],"pagamento":"..."}

FLAGS:
[OPT_OUT] — cliente pediu pra não ser contactado
[FOTO_SLUG] — envia foto do produto
[VIDEO_SLUG] — envia vídeo do produto
[ESCALAR] — cliente insiste em falar com humano`;

export async function processAIResponse(
  conversationId: string,
  userMessage: string,
  agent: AgentConfig,
  incomingMessageId?: string
): Promise<void> {
  try {
    const [recentMessages, conversation] = await Promise.all([
      prisma.whatsappMessage.findMany({
        where: { conversationId },
        orderBy: { sentAt: "desc" },
        take: 20,
      }),
      prisma.whatsappConversation.findUnique({
        where: { id: conversationId },
        include: { provider: true, lead: true },
      }),
    ]);

    if (!conversation) return;

    // Stop AI if lead already escalated
    if (conversation.lead?.status === "ESCALATED") return;

    // ── Sandbox mode ──────────────────────────────────────────────────────────
    if (agent.sandboxMode) {
      const sandboxNumber = process.env.SANDBOX_TEST_NUMBER ?? process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";
      const customerNum = conversation.customerWhatsappBusinessId.replace(/\D/g, "");
      const sandboxNum = sandboxNumber.replace(/\D/g, "");
      if (customerNum !== sandboxNum) {
        console.log(`[AI Agent] Sandbox mode — skipping response to ${customerNum}`);
        return;
      }
    }

    // ── Detect consecutive user messages (reply-to quoting) ──────────────────
    let consecutiveUserMsgs = 0;
    for (const msg of recentMessages) {
      if (msg.role === "USER") consecutiveUserMsgs++;
      else break;
    }
    const contextMessageId = consecutiveUserMsgs > 1 && incomingMessageId ? incomingMessageId : undefined;

    // ── ETAPA 1: Detect lead state ────────────────────────────────────────────
    const leadState = detectLeadState(userMessage);
    const isFirstInteraction = recentMessages.filter((m) => m.role === "ASSISTANT").length === 0;

    const lead = conversation.lead;
    const orgId = conversation.provider.organizationId;

    // ── ETAPA 6: Load AI config ───────────────────────────────────────────────
    const aiConfig = await prisma.aiConfig.findUnique({ where: { organizationId: orgId } });

    // Lead context block
    const leadContext = lead
      ? [
          `\n\n--- CONTEXTO DO LEAD ---`,
          `Nome: ${lead.profileName ?? "Não informado"}`,
          `Telefone: ${lead.phoneNumber}`,
          `Email: ${lead.email ?? "Não informado"}`,
          `Origem: ${lead.leadOrigin === "INBOUND" ? "Inbound" : "Outbound"}`,
          `Status: ${lead.status}`,
          `Cliente desde: ${lead.createdAt.toLocaleDateString("pt-BR")}`,
          `--- FIM DO CONTEXTO ---`,
        ].join("\n")
      : "";

    // Active products catalog
    const activeProducts = await prisma.product.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: { createdAt: "asc" },
    });

    let productSection = "";
    if (activeProducts.length > 0) {
      const lines = activeProducts.map((p, i) => {
        const slug = p.name.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
        const parts = [
          `Produto ${i + 1} — ${p.name} [slug: ${slug}]`,
          p.description ?? null,
          `Preço: R$${p.price.toFixed(2)}${p.priceInstallments && p.installments ? ` à vista ou ${p.installments}x de R$${p.priceInstallments.toFixed(2)}` : ""}`,
          p.imageUrl ? `→ Inclua [FOTO_${slug}] para enviar a foto` : null,
          p.videoUrl ? `→ Inclua [VIDEO_${slug}] para enviar o vídeo` : null,
        ].filter(Boolean);
        return parts.join("\n");
      });
      productSection = "\n\nPRODUTOS ATUAIS NO CATÁLOGO:\n" + lines.join("\n\n");
    }

    // ── Build full system prompt ──────────────────────────────────────────────
    const basePrompt = agent.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const withCatalog = activeProducts.length > 0
      ? basePrompt.replace(/\nPRODUTOS:[\s\S]*?(?=\nPagamento|\nQuando|\nSe o cliente|$)/i, productSection + "\n")
      : basePrompt;

    const hour = new Date().getHours();
    const runtimeContext = buildRuntimeContext(leadState, isFirstInteraction, aiConfig, hour);
    const systemPromptFinal = withCatalog + productSection + leadContext + runtimeContext;

    const chatHistory = recentMessages
      .reverse()
      .slice(0, -1)
      .map((m) => ({
        role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));

    const response = await callLLM(
      systemPromptFinal,
      chatHistory,
      userMessage,
      agent.aiProvider ?? undefined,
      agent.aiModel ?? undefined
    );

    if (!response) return;

    const provider = conversation.provider;
    const to = conversation.customerWhatsappBusinessId;
    const token = provider.accessToken ?? undefined;
    const now = new Date();

    // ── Handle [OPT_OUT] ──────────────────────────────────────────────────────
    if (/\[OPT_OUT\]/i.test(response)) {
      await Promise.all([
        prisma.lead.update({ where: { id: conversation.leadId }, data: { status: "BLOCKED" } }),
        prisma.conversationFollowUp.updateMany({
          where: { conversationId, status: "ACTIVE" },
          data: { status: "OPT_OUT" },
        }),
      ]);
    }

    // ── Handle [PASSAGEM] ─────────────────────────────────────────────────────
    const passagemMatch = response.match(/\[PASSAGEM\]\s*(\{[\s\S]*?\})/i);
    if (passagemMatch) {
      try {
        const orderData = JSON.parse(passagemMatch[1]);
        const produtosStr = Array.isArray(orderData.produtos)
          ? orderData.produtos.map((p: { nome: string; qtd?: number }) => `${p.nome} x${p.qtd ?? 1}`).join(", ")
          : orderData.produtos ?? "N/A";

        const handoffMsg =
          `*🔔 NOVO PEDIDO — NEXO BRASIL*\n\n` +
          `👤 *Nome:* ${orderData.nome ?? "?"}\n` +
          `📍 *Endereço:* ${orderData.endereco ?? "?"}, ${orderData.bairro ?? ""} — CEP ${orderData.cep ?? ""}\n` +
          `📱 *Telefone:* ${orderData.telefone ?? to}\n` +
          `📦 *Produto(s):* ${produtosStr}\n` +
          `💳 *Pagamento:* ${orderData.pagamento ?? "?"}\n\n` +
          `_Encaminhe para finalizar a entrega._`;

        const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";
        await sendWhatsAppMessage(provider.businessPhoneNumberId, ownerNumber, handoffMsg, token)
          .catch((e) => console.error("[AI Agent] Passagem send failed:", e));

        await prisma.ownerNotification.create({
          data: {
            type: "ORDER",
            title: `Novo pedido: ${orderData.nome ?? "Cliente"}`,
            body: handoffMsg,
            organizationId: orgId,
            leadId: conversation.leadId,
            conversationId,
          },
        });
      } catch (e) {
        console.error("[AI Agent] Failed to parse PASSAGEM JSON:", e);
      }
    }

    // ── Handle [ESCALAR] ──────────────────────────────────────────────────────
    if (response.startsWith("[ESCALAR]") || /\[ESCALAR\]/i.test(response)) {
      await handleEscalation(conversation.leadId, conversationId, response);
      await prisma.ownerNotification.create({
        data: {
          type: "ESCALATION",
          title: `Lead escalado: ${lead?.profileName ?? to}`,
          body: `O cliente ${lead?.profileName ?? to} foi escalado para atendimento humano.`,
          organizationId: orgId,
          leadId: conversation.leadId,
          conversationId,
        },
      }).catch(() => {});
    }

    // ── Strip all flags ───────────────────────────────────────────────────────
    const mediaFlagPattern = /\[(FOTO|VIDEO)_[A-Z0-9_]+\]/gi;
    const cleanResponse = response
      .replace(/^\[ESCALAR\]\s*/i, "")
      .replace(/^\[AGENDAR\]\s*/i, "")
      .replace(/\[PASSAGEM\]\s*\{[\s\S]*?\}/gi, "")
      .replace(/\[OPT_OUT\]/gi, "")
      .replace(mediaFlagPattern, "")
      .trim();

    if (!cleanResponse) return;

    // ── ETAPA 7: Simulate typing before first message ─────────────────────────
    if (incomingMessageId && provider.businessPhoneNumberId) {
      await simulateTypingDelay(
        provider.businessPhoneNumberId,
        incomingMessageId,
        cleanResponse,
        token
      );
    }

    // ── ETAPA 2 & 7: Split into multiple messages + send with delays ──────────
    const messages = splitMessages(cleanResponse);

    for (let i = 0; i < messages.length; i++) {
      if (i > 0) {
        const delayMs = SEND_DELAYS_MS[Math.min(i, SEND_DELAYS_MS.length - 1)];
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const msgNow = new Date();
      const msgText = messages[i];

      await prisma.whatsappMessage.create({
        data: {
          content: msgText,
          type: "TEXT",
          role: "ASSISTANT",
          sentAt: msgNow,
          status: "SENT",
          conversationId,
        },
      });

      await sendWhatsAppMessage(
        provider.businessPhoneNumberId,
        to,
        msgText,
        token,
        i === 0 ? contextMessageId : undefined
      );
    }

    await prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    // ── Send product photos/videos (after text messages) ──────────────────────
    for (const product of activeProducts) {
      const slug = product.name.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      if (new RegExp(`\\[FOTO_${slug}\\]`, "i").test(response) && product.imageUrl) {
        await sendWhatsAppImage(provider.businessPhoneNumberId, to, product.imageUrl, product.name, token, contextMessageId)
          .catch((e) => console.error(`[AI Agent] Image send failed for ${product.name}:`, e));
      }
      if (new RegExp(`\\[VIDEO_${slug}\\]`, "i").test(response) && product.videoUrl) {
        await sendWhatsAppVideo(provider.businessPhoneNumberId, to, product.videoUrl, product.name, token, contextMessageId)
          .catch((e) => console.error(`[AI Agent] Video send failed for ${product.name}:`, e));
      }
    }

    // ── ETAPA 8: Schedule follow-up ───────────────────────────────────────────
    const nextSendAt = new Date(now.getTime() + FOLLOWUP_INTERVALS_MS[0]);
    await prisma.conversationFollowUp.upsert({
      where: { conversationId },
      update: { step: 1, status: "ACTIVE", aiMessageAt: now, nextSendAt, leadName: lead?.profileName ?? null },
      create: {
        conversationId,
        step: 1,
        status: "ACTIVE",
        aiMessageAt: now,
        nextSendAt,
        leadName: lead?.profileName ?? null,
        phoneNumber: to,
        phoneNumberId: provider.businessPhoneNumberId,
        accessToken: provider.accessToken,
      },
    });
  } catch (error) {
    console.error("[AI Agent] Error:", error);
  }
}

async function callLLM(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  aiProvider?: string,
  aiModel?: string
): Promise<string | null> {
  const provider = aiProvider?.toUpperCase();

  if (provider === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY) {
    const r = await callAnthropic(systemPrompt, history, userMessage, aiModel ?? "claude-sonnet-4-6");
    if (r) return r;
  }
  if (provider === "OPENAI" && process.env.OPENAI_API_KEY) {
    const r = await callOpenAI(systemPrompt, history, userMessage, aiModel ?? "gpt-4o-mini");
    if (r) return r;
  }
  if (provider === "GOOGLE" && process.env.GOOGLE_AI_API_KEY) {
    const r = await callGemini(systemPrompt, history, userMessage, aiModel ?? "gemini-2.0-flash-lite");
    if (r) return r;
  }

  // Fallback chain: Anthropic → OpenAI → Google
  console.warn(`[AI Agent] Provider ${provider} falhou ou não configurado — tentando fallback`);
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await callAnthropic(systemPrompt, history, userMessage, "claude-sonnet-4-6");
    if (r) return r;
  }
  if (process.env.OPENAI_API_KEY) {
    const r = await callOpenAI(systemPrompt, history, userMessage, "gpt-4o-mini");
    if (r) return r;
  }
  if (process.env.GOOGLE_AI_API_KEY) {
    const r = await callGemini(systemPrompt, history, userMessage, "gemini-2.0-flash-lite");
    if (r) return r;
  }

  console.warn("[AI Agent] Nenhuma API key de LLM disponível ou todas falharam");
  return null;
}

async function callOpenAI(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  model: string
): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userMessage }],
      max_tokens: 400,
      temperature: 0.85,
    }),
  });
  if (!res.ok) { console.error("[OpenAI] Error:", await res.text()); return null; }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? null;
}

async function callAnthropic(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  model: string
): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: [...history, { role: "user", content: userMessage }],
      max_tokens: 400,
    }),
  });
  if (!res.ok) { console.error("[Anthropic] Error:", await res.text()); return null; }
  const data = await res.json() as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? null;
}

async function callGemini(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  model: string
): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [
        ...history.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        { role: "user", parts: [{ text: userMessage }] },
      ],
      generationConfig: { maxOutputTokens: 400, temperature: 0.85 },
    }),
  });
  if (!res.ok) { console.error("[Gemini] Error:", await res.text()); return null; }
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

async function handleEscalation(leadId: string, conversationId: string, reason: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { kanbanColumn: true } });
  if (!lead || lead.status === "ESCALATED") return;

  const escalatedColumn = await prisma.kanbanColumn.findFirst({
    where: { organizationId: lead.organizationId, type: "ESCALATED" },
  });
  if (escalatedColumn) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { kanbanColumnId: escalatedColumn.id, status: "ESCALATED", lastActivityAt: new Date() },
    });
  }

  await prisma.leadEscalation.create({
    data: { leadId, reason: reason.replace(/^\[ESCALAR\]\s*/i, "").substring(0, 500), status: "PENDING" },
  });
  await prisma.leadActivity.create({
    data: { leadId, type: "STATUS_CHANGE", description: "Lead escalado para vendedor humano pela IA", createdBy: "AI_AGENT" },
  });
  await prisma.whatsappMessage.create({
    data: {
      content: "🔔 *Lead escalado para atendimento humano.* Um vendedor assumirá esta conversa em breve.",
      type: "TEXT",
      role: "ASSISTANT",
      sentAt: new Date(),
      status: "SENT",
      conversationId,
    },
  });
}
