import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage, sendWhatsAppImage, sendWhatsAppVideo, simulateTypingDelay } from "@/lib/whatsapp/send";

// ─── Follow-up intervals ─────────────────────────────────────────────────────
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

interface LeadState {
  tipo: "curioso" | "interessado" | "quente" | "frio";
  urgencia: "baixa" | "media" | "alta";
}

interface AIResponse {
  mensagens: string[];
  delays: number[];
}

// ── Detecção de estado do lead ────────────────────────────────────────────────
function detectLeadState(message: string): LeadState {
  const msg = message.toLowerCase();
  if (/quero\b|como\s+compra|entrega\s+quando|pronta\s+entrega|vou\s+comprar|quero\s+comprar|fechar|confirmar|fazer\s+pedido|finalizar/.test(msg)) {
    return { tipo: "quente", urgencia: "alta" };
  }
  if (/quanto\s+custa|qual\s+o\s+pre[çc]o|qual\s+o\s+valor|pre[çc]o|valor|como\s+funciona|tem\s+dispon[ií]vel|tem\s+estoque|parcel/.test(msg)) {
    return { tipo: "interessado", urgencia: "media" };
  }
  if (/depois|vou\s+ver|talvez|n[aã]o\s+sei|to\s+vendo|t[oô]\s+vendo|ta\s+caro|t[aá]\s+caro|muito\s+caro|caro\s+demais/.test(msg)) {
    return { tipo: "frio", urgencia: "baixa" };
  }
  return { tipo: "curioso", urgencia: "baixa" };
}

// ── Detecta pedido de múltiplos dados de endereço de uma vez ─────────────────
function isOverloadedRequest(msg: string): boolean {
  const fields = [
    /endere[çc]o/i,
    /\bcep\b/i,
    /telefone|fone|celular|whatsapp/i,
    /nome\s+completo/i,
    /\bbairro\b/i,
    /me\s+passa\s+(seu|o)/i,
    /finalizar\s+o\s+pedido/i,
    /confirmar\s+o\s+pedido/i,
  ];
  return fields.filter((re) => re.test(msg)).length >= 2;
}

// ── Sanitiza mensagens — remove sobrecarga de dados e trunca textos longos ───
function sanitizeMessages(msgs: string[]): string[] {
  return msgs.map((m) => {
    if (isOverloadedRequest(m)) return "me manda sua localização 📍";
    if (m.length > 160) return m.substring(0, 157) + "...";
    return m;
  });
}

// ── Parser da resposta JSON do LLM ────────────────────────────────────────────
function parseAIResponse(raw: string): AIResponse {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    const parsed = JSON.parse(stripped) as { mensagens?: unknown; delays?: unknown };
    if (Array.isArray(parsed.mensagens) && parsed.mensagens.length > 0) {
      const msgs: string[] = (parsed.mensagens as unknown[]).map((m) => String(m).trim()).filter(Boolean);
      const rawDelays = Array.isArray(parsed.delays) ? (parsed.delays as unknown[]) : [];
      const delays: number[] = msgs.map((_, i) =>
        typeof rawDelays[i] === "number" ? (rawDelays[i] as number) : i === 0 ? 0 : 1500 + Math.min(i - 1, 2) * 500
      );
      return { mensagens: sanitizeMessages(msgs), delays };
    }
  } catch { /* fall through */ }

  // Fallback: separador ||
  const byPipe = stripped.split("||").map((m) => m.trim()).filter(Boolean);
  if (byPipe.length > 1) {
    return { mensagens: sanitizeMessages(byPipe), delays: byPipe.map((_, i) => (i === 0 ? 0 : 1500 + Math.min(i - 1, 2) * 500)) };
  }

  return { mensagens: sanitizeMessages([stripped]), delays: [0] };
}

// ── Contexto de runtime injetado no prompt a cada chamada ────────────────────
function buildRuntimeContext(
  leadState: LeadState,
  msgCount: number,
  isFirstInteraction: boolean,
  aiConfig: { usarEmoji: boolean; usarReticencias: boolean; nivelVenda: string } | null,
  hour: number
): string {
  const greeting = hour < 12 ? "bom dia" : hour < 18 ? "boa tarde" : "boa noite";
  const emoji = aiConfig?.usarEmoji !== false;
  const reticencias = aiConfig?.usarReticencias !== false;
  const nivel = aiConfig?.nivelVenda ?? "medio";

  // Etapa da conversa baseada na contagem de mensagens trocadas
  let etapa: string;
  if (isFirstInteraction) {
    etapa = `ETAPA 1 — CONECTAR: cumprimente ("${greeting}"), se apresente (Pedro, Nexo Brasil) em mensagens curtas separadas. Faça UMA pergunta de qualificação natural sobre o uso do produto.`;
  } else if (msgCount <= 4) {
    etapa = `ETAPA 2 — DESCOBRIR: entenda a dor/necessidade real do cliente. Recomende UM produto específico conectando ao problema dele. Use "essa aqui é exatamente pra isso".`;
  } else if (msgCount <= 8) {
    if (leadState.tipo === "quente") {
      etapa = `ETAPA 3 — FECHAR: lead quente. Vá direto. "posso separar uma pra você${emoji ? " 👍" : ""}?" → depois "me manda sua localização 📍".`;
    } else if (leadState.tipo === "frio") {
      etapa = `ETAPA 3 — REENGAJAR: use escassez natural ("última que tenho aqui...") ou prova social ("aqui em Goiânia tô mandando bastante"). Não force.`;
    } else {
      etapa = `ETAPA 3 — GERAR DESEJO: reforce o benefício principal conectado à dor dele. Antecipe a objeção de preço com "e o melhor: só paga quando chegar na sua mão". Envie a mídia do produto.`;
    }
  } else {
    etapa = `ETAPA 4 — COLETAR DADOS: assumindo a venda. Peça dados progressivamente: primeiro localização, depois nome, depois confirme o produto e pagamento. Nunca tudo de uma vez.`;
  }

  const nivelInstr: Record<string, string> = {
    leve: "Responda e deixe o cliente conduzir. Não empurre.",
    medio: "Conduza naturalmente. Após responder, avance um passo com uma pergunta curta ou sugestão.",
    agressivo: "Conduza ativamente para o fechamento em cada mensagem. Use urgência e escassez com naturalidade.",
  };

  return [
    `\n\n--- RUNTIME ---`,
    `Hora: ${hour}h | Estado do lead: ${leadState.tipo} | Urgência: ${leadState.urgencia}`,
    `Mensagens trocadas: ${msgCount} | Primeira vez: ${isFirstInteraction ? "SIM" : "NÃO"}`,
    `Emoji: ${emoji ? "SIM (máx 1/msg)" : "NÃO"} | Reticências: ${reticencias ? "SIM (com moderação)" : "NÃO"}`,
    `Nível de venda: ${nivelInstr[nivel] ?? nivelInstr.medio}`,
    ``,
    etapa,
    ``,
    `FORMATO OBRIGATÓRIO — responda SEMPRE em JSON:`,
    `{"mensagens": ["msg1", "msg2"], "delays": [0, 1800]}`,
    `Regras: 1 ideia por mensagem • sem listas • sem markdown • sem "Claro!" "Ótimo!" "Entendido!"`,
    `NUNCA pedir endereço+CEP+telefone na mesma mensagem. Use só: "me manda sua localização 📍"`,
    `Para enviar mídia: inclua [FOTO_SLUG] ou [VIDEO_SLUG] dentro de uma mensagem do array (substitua SLUG pelo slug do produto).`,
    `--- FIM RUNTIME ---`,
  ].join("\n");
}

// ── Prompt base (usado quando o agente não tem prompt customizado) ─────────────
const DEFAULT_SYSTEM_PROMPT = `Você é Pedro, vendedor da Nexo Brasil — ferramentas profissionais, entrega em Goiânia e região.

QUEM É PEDRO:
Pedro tem 5 anos vendendo ferramentas. Conhece cada cliente pelo tipo de trabalho. É direto, descontraído, não enrola. Fala como um amigo que entende do assunto — não como atendente de SAC.

Pedro NUNCA diz "Claro!", "Certamente!", "Ótimo!", "Entendido!", "Como posso ajudar?".
Pedro NUNCA usa listas, bullets, formatação.
Pedro NUNCA escreve parágrafos — cada mensagem = 1 frase curta.
Pedro NUNCA menciona ser IA, assistente virtual ou robô.

COMO PEDRO FALA:
- Linguagem natural: "vc", "ta", "né", "mto", "tb", "pq", "tô"
- Erros leves e naturais às vezes: "tamem", "voce", "qnd", "msm"
- Mensagens de 1 a 2 linhas no máximo
- Varia os inícios: "oi", "então", "olha", "essa aqui", "é", "cara", "aqui"
- Quando manda preço, para e espera. Não preenche o silêncio.

O QUE PEDRO SABE (use naturalmente na conversa):
- Pagamento SOMENTE na entrega — é o principal argumento de confiança ("vc não paga nada antes")
- Entrega em Goiânia e região — sem retirada presencial
- Nota fiscal + 1 ano de garantia em tudo
- Prova social regional: "aqui em Goiânia tô mandando bastante essa semana", "profissional que usa todo dia escolhe essa"
- Escassez plausível: "essa tá acabando", "última unidade que tenho aqui"
- Linguagem assumida: "quando chegar na sua mão", "aí na sua obra", "vc vai notar a diferença"

NUNCA faça:
- Pedir endereço completo + CEP + telefone tudo numa mensagem só
- Apresentar 2+ produtos ao mesmo tempo
- Perguntar "posso te ajudar em algo mais?"
- Repetir o que o cliente falou
- Escrever mensagens longas

FECHAMENTO — coleta progressiva:
1. "me manda sua localização 📍"
2. "e o nome completo?"
3. Confirme produto e pagamento
4. Quando tiver TUDO, emita: [PASSAGEM]{"nome":"...","endereco":"...","cep":"...","bairro":"...","telefone":"...","produtos":[{"nome":"...","qtd":1}],"pagamento":"..."}

FLAGS:
[OPT_OUT] — cliente pediu pra não ser mais contactado
[FOTO_SLUG] — envia foto do produto (substitua SLUG pelo slug)
[VIDEO_SLUG] — envia vídeo do produto (substitua SLUG pelo slug)
[ESCALAR] — cliente insiste muito em falar com humano`;

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
        take: 30,
      }),
      prisma.whatsappConversation.findUnique({
        where: { id: conversationId },
        include: { provider: true, lead: true },
      }),
    ]);

    if (!conversation) return;
    if (conversation.lead?.status === "ESCALATED") return;

    // ── Sandbox mode ──────────────────────────────────────────────────────────
    if (agent.sandboxMode) {
      const sandboxNumber = process.env.SANDBOX_TEST_NUMBER ?? process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";
      const customerNum = conversation.customerWhatsappBusinessId.replace(/\D/g, "");
      if (customerNum !== sandboxNumber.replace(/\D/g, "")) {
        console.log(`[AI Agent] Sandbox mode — skipping ${customerNum}`);
        return;
      }
    }

    // ── Contexto ──────────────────────────────────────────────────────────────
    const lead = conversation.lead;
    const orgId = conversation.provider.organizationId;

    // Contagem de mensagens trocadas (para detectar etapa da conversa)
    const msgCount = recentMessages.length;
    const isFirstInteraction = recentMessages.filter((m) => m.role === "ASSISTANT").length === 0;

    // Quote the latest message if client sent 2+ in a row without reply
    let consecutiveUser = 0;
    for (const m of recentMessages) { if (m.role === "USER") consecutiveUser++; else break; }
    const contextMessageId = consecutiveUser > 1 && incomingMessageId ? incomingMessageId : undefined;

    // ── Detectar estado do lead ───────────────────────────────────────────────
    const leadState = detectLeadState(userMessage);

    // ── Carregar AiConfig ─────────────────────────────────────────────────────
    const aiConfig = await prisma.aiConfig.findUnique({ where: { organizationId: orgId } }).catch(() => null);

    // ── Produtos ativos ───────────────────────────────────────────────────────
    const activeProducts = await prisma.product.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: { createdAt: "asc" },
    });

    let productSection = "";
    if (activeProducts.length > 0) {
      const lines = activeProducts.map((p, i) => {
        const slug = p.name.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
        const hasMedia = p.imageUrl || (p as typeof p & { imageUrls?: string[] }).imageUrls?.length || p.videoUrl;
        return [
          `Produto ${i + 1} — ${p.name} [slug: ${slug}]`,
          p.description ?? null,
          `Preço: R$${p.price.toFixed(2)}${p.priceInstallments && p.installments ? ` à vista | ${p.installments}x de R$${p.priceInstallments.toFixed(2)}` : ""}`,
          hasMedia ? `→ Para enviar fotos/vídeo: inclua [FOTO_${slug}] ou [VIDEO_${slug}] em uma das mensagens` : null,
        ].filter(Boolean).join("\n");
      });
      productSection = "\n\nCATÁLOGO:\n" + lines.join("\n\n");
    }

    // ── Contexto do lead ──────────────────────────────────────────────────────
    const leadContext = lead ? [
      `\n--- LEAD ---`,
      `Nome: ${lead.profileName ?? "desconhecido"}`,
      `Telefone: ${lead.phoneNumber}`,
      `Status: ${lead.status}`,
      `--- FIM ---`,
    ].join("\n") : "";

    // ── Montar prompt final ───────────────────────────────────────────────────
    const basePrompt = agent.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const hour = new Date().getHours();
    const runtimeCtx = buildRuntimeContext(leadState, msgCount, isFirstInteraction, aiConfig, hour);
    const systemPromptFinal = basePrompt + productSection + leadContext + runtimeCtx;

    // ── Histórico de chat ─────────────────────────────────────────────────────
    const chatHistory = recentMessages
      .slice()
      .reverse()
      .slice(0, -1)
      .map((m) => ({ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), content: m.content }));

    // ── Chamada ao LLM ────────────────────────────────────────────────────────
    const rawResponse = await callLLM(systemPromptFinal, chatHistory, userMessage, agent.aiProvider ?? undefined, agent.aiModel ?? undefined);
    if (!rawResponse) return;

    // ── Parse de multi-mensagens ──────────────────────────────────────────────
    const { mensagens: rawMsgs, delays } = parseAIResponse(rawResponse);
    const combinedRaw = [rawResponse, ...rawMsgs].join("\n");
    const mediaFlagRe = /\[(FOTO|VIDEO)_[A-Z0-9_]+\]/gi;

    // ── Limpar flags das mensagens que vão pro cliente ────────────────────────
    const mensagens = rawMsgs.map((m) =>
      m.replace(/^\[ESCALAR\]\s*/i, "")
        .replace(/\[PASSAGEM\]\s*\{[\s\S]*?\}/gi, "")
        .replace(/\[OPT_OUT\]/gi, "")
        .replace(mediaFlagRe, "")
        .trim()
    ).filter(Boolean);

    if (mensagens.length === 0) return;

    const provider = conversation.provider;
    const to = conversation.customerWhatsappBusinessId;
    const token = provider.accessToken ?? undefined;
    const now = new Date();

    // ── [OPT_OUT] ─────────────────────────────────────────────────────────────
    if (/\[OPT_OUT\]/i.test(combinedRaw)) {
      await Promise.all([
        prisma.lead.update({ where: { id: conversation.leadId }, data: { status: "BLOCKED" } }),
        prisma.conversationFollowUp.updateMany({ where: { conversationId, status: "ACTIVE" }, data: { status: "OPT_OUT" } }),
      ]);
    }

    // ── [PASSAGEM] ────────────────────────────────────────────────────────────
    const passagemMatch = combinedRaw.match(/\[PASSAGEM\]\s*(\{[\s\S]*?\})/i);
    if (passagemMatch) {
      try {
        const orderData = JSON.parse(passagemMatch[1]);
        const produtosStr = Array.isArray(orderData.produtos)
          ? orderData.produtos.map((p: { nome: string; qtd?: number }) => `${p.nome} x${p.qtd ?? 1}`).join(", ")
          : String(orderData.produtos ?? "N/A");
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
          data: { type: "ORDER", title: `Novo pedido: ${orderData.nome ?? "Cliente"}`, body: handoffMsg, organizationId: orgId, leadId: conversation.leadId, conversationId },
        }).catch(() => {});
      } catch (e) { console.error("[AI Agent] PASSAGEM parse error:", e); }
    }

    // ── [ESCALAR] ─────────────────────────────────────────────────────────────
    if (/\[ESCALAR\]/i.test(combinedRaw)) {
      await handleEscalation(conversation.leadId, conversationId, rawResponse);
      await prisma.ownerNotification.create({
        data: { type: "ESCALATION", title: `Lead escalado: ${lead?.profileName ?? to}`, body: `${lead?.profileName ?? to} pediu atendimento humano.`, organizationId: orgId, leadId: conversation.leadId, conversationId },
      }).catch(() => {});
    }

    // ── Simular digitação antes da 1ª mensagem ────────────────────────────────
    if (incomingMessageId && provider.businessPhoneNumberId) {
      await simulateTypingDelay(provider.businessPhoneNumberId, incomingMessageId, mensagens.join(" "), token);
    }

    // ── Enviar mensagens com delays individuais ───────────────────────────────
    for (let i = 0; i < mensagens.length; i++) {
      const delayMs = delays[i] ?? 0;
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const msgNow = new Date();
      await prisma.whatsappMessage.create({
        data: { content: mensagens[i], type: "TEXT", role: "ASSISTANT", sentAt: msgNow, status: "SENT", conversationId },
      });
      await sendWhatsAppMessage(provider.businessPhoneNumberId, to, mensagens[i], token, i === 0 ? contextMessageId : undefined);
    }

    await prisma.whatsappConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });

    // ── Enviar fotos + vídeo do produto ───────────────────────────────────────
    // WhatsApp exige URLs HTTPS públicas — converte base64 para endpoint público
    const appUrl = (process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const toPublicUrl = (url: string, productId: string, idx: number, isVideo = false): string => {
      if (url.startsWith("data:")) {
        return isVideo ? `${appUrl}/api/media/product/${productId}?type=video` : `${appUrl}/api/media/product/${productId}?idx=${idx}`;
      }
      return url;
    };

    for (const product of activeProducts) {
      const slug = product.name.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      const triggerFoto  = new RegExp(`\\[FOTO_${slug}\\]`, "i").test(combinedRaw);
      const triggerVideo = new RegExp(`\\[VIDEO_${slug}\\]`, "i").test(combinedRaw);

      if (triggerFoto) {
        const p = product as typeof product & { imageUrls?: string[] };
        const imgs: string[] = p.imageUrls?.length ? p.imageUrls : product.imageUrl ? [product.imageUrl] : [];
        for (let i = 0; i < imgs.length; i++) {
          await new Promise((r) => setTimeout(r, 800));
          await sendWhatsAppImage(provider.businessPhoneNumberId, to, toPublicUrl(imgs[i], product.id, i), product.name, token)
            .catch((e) => console.error(`[AI Agent] Image failed ${product.name}:`, e));
        }
      }

      if (triggerVideo && product.videoUrl) {
        await new Promise((r) => setTimeout(r, 1000));
        await sendWhatsAppVideo(provider.businessPhoneNumberId, to, toPublicUrl(product.videoUrl, product.id, 0, true), product.name, token)
          .catch((e) => console.error(`[AI Agent] Video failed ${product.name}:`, e));
      }
    }

    // ── Agendar follow-up ─────────────────────────────────────────────────────
    const nextSendAt = new Date(now.getTime() + FOLLOWUP_INTERVALS_MS[0]);
    await prisma.conversationFollowUp.upsert({
      where: { conversationId },
      update: { step: 1, status: "ACTIVE", aiMessageAt: now, nextSendAt, leadName: lead?.profileName ?? null },
      create: { conversationId, step: 1, status: "ACTIVE", aiMessageAt: now, nextSendAt, leadName: lead?.profileName ?? null, phoneNumber: to, phoneNumberId: provider.businessPhoneNumberId, accessToken: provider.accessToken },
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
  const p = aiProvider?.toUpperCase();
  // Tenta o provider configurado primeiro
  if (p === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY) { const r = await callAnthropic(systemPrompt, history, userMessage, aiModel ?? "claude-haiku-4-5-20251001"); if (r) return r; }
  if (p === "OPENAI"    && process.env.OPENAI_API_KEY)    { const r = await callOpenAI(systemPrompt, history, userMessage, aiModel ?? "gpt-4o-mini"); if (r) return r; }
  if (p === "GOOGLE"    && process.env.GOOGLE_AI_API_KEY) { const r = await callGemini(systemPrompt, history, userMessage, aiModel ?? "gemini-2.0-flash-lite"); if (r) return r; }
  // Fallback chain
  if (process.env.ANTHROPIC_API_KEY) { const r = await callAnthropic(systemPrompt, history, userMessage, "claude-haiku-4-5-20251001"); if (r) return r; }
  if (process.env.GOOGLE_AI_API_KEY) { const r = await callGemini(systemPrompt, history, userMessage, "gemini-2.0-flash-lite"); if (r) return r; }
  if (process.env.OPENAI_API_KEY)    { const r = await callOpenAI(systemPrompt, history, userMessage, "gpt-4o-mini"); if (r) return r; }
  console.warn("[AI Agent] Nenhuma API key de LLM disponível");
  return null;
}

async function callOpenAI(systemPrompt: string, history: Array<{ role: "user" | "assistant"; content: string }>, userMessage: string, model: string): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userMessage }], max_tokens: 400, temperature: 0.9 }),
  });
  if (!res.ok) { console.error("[OpenAI] Error:", await res.text()); return null; }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? null;
}

async function callAnthropic(systemPrompt: string, history: Array<{ role: "user" | "assistant"; content: string }>, userMessage: string, model: string): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, system: systemPrompt, messages: [...history, { role: "user", content: userMessage }], max_tokens: 400 }),
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
      generationConfig: { maxOutputTokens: 400, temperature: 0.9 },
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
