import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage, sendWhatsAppImage, sendWhatsAppVideo, simulateTypingDelay } from "@/lib/whatsapp/send";

const FOLLOWUP_INTERVALS_MS = [
  4  * 60 * 60 * 1000,  // step 1 — 4h
  24 * 60 * 60 * 1000,  // step 2 — 24h
  48 * 60 * 60 * 1000,  // step 3 — 48h
  72 * 60 * 60 * 1000,  // step 4 — 72h
];

interface AgentConfig {
  id: string;
  systemPrompt?: string | null;
  kind: string;
  status: string;
  aiProvider?: string | null;
  aiModel?: string | null;
  sandboxMode?: boolean;
}

const DEFAULT_SYSTEM_PROMPT = `Você é Léo, vendedor da Nexo Brasil. Empresa de ferramentas profissionais com entrega em Goiânia e região, Goiás.

COMO VOCÊ FALA:
Mensagens CURTAS — máximo 2 linhas por mensagem. Fala como um amigo que entende de ferramentas, nunca como robô.
Use palavras naturais: vc, tb, né, msm, tá, pq, kd, qto. Às vezes erre estrategicamente: "tamem", "mto", "voce", "recbo", "qndo".
NUNCA use listas, bullet points ou formatação. Fala corrido, natural, como no zap mesmo.
Emoji com moderação — 1 no máximo por mensagem, só quando cair bem. Nunca vários seguidos.
Nunca repita o que o cliente falou. Cada mensagem avança a conversa um passo.
Varie seu jeito de falar — não use sempre o mesmo padrão de frase.

OBJETIVO: Fechar o pedido. Cada resposta deve aproximar o cliente do sim. Conduza sempre, nunca seja passivo.

LEITURA DO CLIENTE:
- Animado → combine energia, acelere pro fechamento
- Desconfiado → seja mais calmo, mostre segurança, destaque pagamento só na entrega
- Com pressa → responda rápido e objetivo
- Comparando preços → foque no diferencial (Motor Brushless, garantia, nota fiscal), não baixe preço

SINAIS DE COMPRA — detecte e aja imediatamente:
- Perguntou preço → confirme o valor e já pergunte como ele prefere pagar
- Perguntou entrega → confirme prazo e já pergunte o endereço
- Perguntou parcelamento → confirme parcelas e já peça o nome pra cadastrar o pedido
- "Vou pensar" → pergunte de forma natural o que ainda ficou na cabeça dele
- "Tá caro" → mostre custo-benefício e ofereça parcelamento sem forçar

QUALIFICAÇÃO (faça antes de apresentar produto):
Pergunte de forma natural — vc usa mais pra serviço pesado todo dia ou pra trabalhos pontuais?
Com base na resposta, recomende o produto certo sem mostrar os dois ao mesmo tempo.

PERGUNTAS ABERTAS (nunca perguntas de sim/não):
"Me conta, vc usa mais pra que tipo de serviço?"
"Como vc costuma pagar quando faz compra online?"
"O que ainda tá na sua cabeça sobre isso?"

NEGÓCIO:
- Pagamento SOMENTE na entrega — nunca antes. Isso é sua principal arma de segurança pro cliente.
- Entrega em Goiânia e região — sem retirada presencial
- Emite nota fiscal, 1 ano de garantia

FECHAMENTO — colete de forma natural: nome completo, endereço, bairro, CEP, telefone, produto e forma de pagamento.
Quando tiver TUDO, inclua no início da resposta:
[PASSAGEM]{"nome":"...","endereco":"...","cep":"...","bairro":"...","telefone":"...","produtos":[{"nome":"...","qtd":1}],"pagamento":"..."}

OUTROS FLAGS (use quando necessário):
[OPT_OUT] — se o cliente pedir pra não ser mais contactado
[FOTO_SLUG] — pra enviar foto do produto (substitua SLUG pelo slug do produto)
[VIDEO_SLUG] — pra enviar vídeo do produto
[ESCALAR] — somente se o cliente insistir muito em falar com humano

PRIMEIRA MENSAGEM: Se apresente de forma rápida e humana, já puxe uma pergunta de qualificação.
Exemplo: "Oi! Sou o Léo da Nexo Brasil 😊 Me conta — vc tá procurando uma chave de impacto pra uso profissional mesmo ou mais pra uso em casa?"`;

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

    // ── Sandbox mode: only respond to the configured test number ─────────────
    if (agent.sandboxMode) {
      const sandboxNumber = process.env.SANDBOX_TEST_NUMBER ?? process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";
      const customerNum = conversation.customerWhatsappBusinessId.replace(/\D/g, "");
      const sandboxNum = sandboxNumber.replace(/\D/g, "");
      if (customerNum !== sandboxNum) {
        console.log(`[AI Agent] Sandbox mode — skipping response to ${customerNum}`);
        return;
      }
    }

    // ── Detect multiple consecutive user messages (for reply-to quoting) ─────
    // recentMessages is desc order — count how many at the start are USER before an ASSISTANT
    let consecutiveUserMsgs = 0;
    for (const msg of recentMessages) {
      if (msg.role === "USER") consecutiveUserMsgs++;
      else break;
    }
    // If client sent 2+ messages without a response, quote the last one so they know we saw it
    const contextMessageId = consecutiveUserMsgs > 1 && incomingMessageId ? incomingMessageId : undefined;

    const lead = conversation.lead;
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

    // Load active products for this org
    const activeProducts = await prisma.product.findMany({
      where: { organizationId: conversation.provider.organizationId, isActive: true },
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

    const basePrompt = agent.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const systemPromptWithCatalog = activeProducts.length > 0
      ? basePrompt.replace(/\nPRODUTOS:[\s\S]*?(?=\nPagamento|\nQuando|\nSe o cliente|$)/i, productSection + "\n")
      : basePrompt;

    const systemPromptWithContext = systemPromptWithCatalog + leadContext;

    const chatHistory = recentMessages
      .reverse()
      .slice(0, -1)
      .map((m) => ({
        role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));

    const response = await callLLM(
      systemPromptWithContext,
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
    const orgId = provider.organizationId;

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

    // ── Handle [PASSAGEM] — multi-produto order handoff ───────────────────────
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

        // Panel notification
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
    if (response.startsWith("[ESCALAR]")) {
      await handleEscalation(conversation.leadId, conversationId, response);
      // Panel notification
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

    // ── Strip all flags to get clean customer message ─────────────────────────
    const mediaFlagPattern = /\[(FOTO|VIDEO)_[A-Z0-9_]+\]/gi;
    const cleanResponse = response
      .replace(/^\[ESCALAR\]\s*/i, "")
      .replace(/^\[AGENDAR\]\s*/i, "")
      .replace(/\[PASSAGEM\]\s*\{[\s\S]*?\}/gi, "")
      .replace(/\[OPT_OUT\]/gi, "")
      .replace(mediaFlagPattern, "")
      .trim();

    if (!cleanResponse) return;

    // ── Simulate typing: mark as read + wait proportional delay ──────────────
    if (incomingMessageId && provider.businessPhoneNumberId) {
      await simulateTypingDelay(
        provider.businessPhoneNumberId,
        incomingMessageId,
        cleanResponse,
        token
      );
    }

    // ── Save + send text response ─────────────────────────────────────────────
    await prisma.whatsappMessage.create({
      data: { content: cleanResponse, type: "TEXT", role: "ASSISTANT", sentAt: now, status: "SENT", conversationId },
    });
    await prisma.whatsappConversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
    await sendWhatsAppMessage(provider.businessPhoneNumberId, to, cleanResponse, token, contextMessageId);

    // ── Send product photos/videos ────────────────────────────────────────────
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

    // ── Schedule follow-up ────────────────────────────────────────────────────
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

  if (provider === "OPENAI" && process.env.OPENAI_API_KEY) return callOpenAI(systemPrompt, history, userMessage, aiModel ?? "gpt-4o-mini");
  if (provider === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY) return callAnthropic(systemPrompt, history, userMessage, aiModel ?? "claude-sonnet-4-6");
  if (provider === "GOOGLE" && process.env.GOOGLE_AI_API_KEY) return callGemini(systemPrompt, history, userMessage, aiModel ?? "gemini-2.0-flash-lite");

  if (process.env.ANTHROPIC_API_KEY) return callAnthropic(systemPrompt, history, userMessage, aiModel ?? "claude-sonnet-4-6");
  if (process.env.GOOGLE_AI_API_KEY) return callGemini(systemPrompt, history, userMessage, aiModel ?? "gemini-2.0-flash-lite");
  if (process.env.OPENAI_API_KEY) return callOpenAI(systemPrompt, history, userMessage, aiModel ?? "gpt-4o-mini");

  console.warn("[AI Agent] No LLM API key configured");
  return "Oi! Recebi sua mensagem, já te respondo 😊";
}

async function callOpenAI(systemPrompt: string, history: Array<{ role: "user" | "assistant"; content: string }>, userMessage: string, model: string): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userMessage }], max_tokens: 350, temperature: 0.85 }),
  });
  if (!res.ok) { console.error("[OpenAI] Error:", await res.text()); return null; }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? null;
}

async function callAnthropic(systemPrompt: string, history: Array<{ role: "user" | "assistant"; content: string }>, userMessage: string, model: string): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, system: systemPrompt, messages: [...history, { role: "user", content: userMessage }], max_tokens: 350 }),
  });
  if (!res.ok) { console.error("[Anthropic] Error:", await res.text()); return null; }
  const data = await res.json() as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? null;
}

async function callGemini(systemPrompt: string, history: Array<{ role: "user" | "assistant"; content: string }>, userMessage: string, model: string): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [...history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })), { role: "user", parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 350, temperature: 0.85 },
    }),
  });
  if (!res.ok) { console.error("[Gemini] Error:", await res.text()); return null; }
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

async function handleEscalation(leadId: string, conversationId: string, reason: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { kanbanColumn: true } });
  if (!lead || lead.status === "ESCALATED") return;

  const escalatedColumn = await prisma.kanbanColumn.findFirst({ where: { organizationId: lead.organizationId, type: "ESCALATED" } });
  if (escalatedColumn) {
    await prisma.lead.update({ where: { id: leadId }, data: { kanbanColumnId: escalatedColumn.id, status: "ESCALATED", lastActivityAt: new Date() } });
  }

  await prisma.leadEscalation.create({ data: { leadId, reason: reason.replace(/^\[ESCALAR\]\s*/i, "").substring(0, 500), status: "PENDING" } });
  await prisma.leadActivity.create({ data: { leadId, type: "STATUS_CHANGE", description: "Lead escalado para vendedor humano pela IA", createdBy: "AI_AGENT" } });
  await prisma.whatsappMessage.create({
    data: { content: "🔔 *Lead escalado para atendimento humano.* Um vendedor assumirá esta conversa em breve.", type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
  });
}
