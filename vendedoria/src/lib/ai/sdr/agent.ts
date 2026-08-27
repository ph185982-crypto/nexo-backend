import { prisma } from "@/lib/prisma/client";
import { callOpenAI, callAnthropic, callGemini } from "@/lib/ai/llm-client";
import { sendWhatsAppMessage, simulateTypingDelay } from "@/lib/whatsapp/send";
import { detectDesinteresse } from "@/lib/ai/agent";
import { cancelFollowUpJobs } from "@/lib/queue/followup-queue";
import { loadSdrSession, saveSdrSession } from "./session";
import { buildSdrSystemPrompt } from "./prompt";
import { type SDRSession, type SDRLLMResponse, SDR_EMPTY_SESSION } from "./types";

const HANDOFF_NUMBER = process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";

// WhatsApp entrega cada mensagem do cliente como um webhook separado. Quando o
// cliente manda 2-3 mensagens seguidas (comum em conversas por celular), cada
// uma dispara sua própria execução do SDR em paralelo — sem essa espera, o
// cliente recebia respostas duplicadas/sobrepostas, uma pra cada mensagem.
const DEBOUNCE_MS = Number(process.env.SDR_DEBOUNCE_MS ?? 7000);

// Falha do LLM (sem resposta ou JSON inválido) nunca deve deixar o cliente sem
// retorno nem passar em silêncio para o dono — manda uma mensagem de espera pro
// cliente e um alerta pro dono no WhatsApp + registro no CRM.
async function notifySdrFailure(
  conversationId: string,
  phoneNumberId: string,
  customerPhone: string,
  token: string | undefined,
  organizationId: string,
  leadName: string | null,
  detalhe: string,
): Promise<void> {
  const fallbackMsg = "opa, tive um probleminha aqui pra processar sua mensagem — já já te respondo, um segundo 🙏";
  try {
    await sendWhatsAppMessage(phoneNumberId, customerPhone, fallbackMsg, token);
    await prisma.whatsappMessage.create({
      data: { content: fallbackMsg, type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
    });
  } catch (e) {
    console.error("[SDR] Erro ao enviar mensagem de espera ao cliente:", e);
  }
  try {
    await sendWhatsAppMessage(
      phoneNumberId, HANDOFF_NUMBER,
      `⚠️ SDR falhou ao responder\n\nCliente: ${leadName ?? customerPhone} (${customerPhone})\nMotivo: ${detalhe}\n\nO cliente recebeu uma mensagem de espera automática — pode ser que precise de atendimento manual.`,
      token,
    );
  } catch (e) {
    console.error("[SDR] Erro ao notificar dono da falha:", e);
  }
  await prisma.ownerNotification.create({
    data: {
      type: "INFO",
      title: `⚠️ SDR falhou ao responder | ${leadName ?? customerPhone}`,
      body: detalhe,
      organizationId,
      conversationId,
    },
  }).catch(() => {});
}

// Formato de handoff enviado ao especialista
function formatHandoffMessage(phone: string, session: SDRSession): string {
  const canais: string[] = [];
  if (session.canais_atuais.length > 0) canais.push(...session.canais_atuais);
  if (session.tem_loja_fisica) canais.push("Loja física");
  if (session.marketplace_atual.length > 0) canais.push(...session.marketplace_atual);
  const canaisStr = canais.length > 0 ? canais.join(", ") : "não informado";

  return `🔥 NOVO LEAD — PASSAGEM DE BASTÃO

👤 Nome: ${session.nome || "não informado"}
📱 WhatsApp: +${phone}
⏰ Melhor período para contato: ${session.disponibilidade || "não informado"}

💰 Faturamento: ${session.faturamento_total || "não informado"}
🏪 Canais de atuação: ${canaisStr}
🎯 Necessidade / Problema principal: ${session.problema_principal || "não informado"}
${session.objecoes_mencionadas.length > 0 ? `\n⚠️ Pontos de atenção: ${session.objecoes_mencionadas.join(", ")}` : ""}

${session.produto_indicado ? `✅ Produto indicado: ${session.produto_indicado}` : ""}
${session.cnpj ? `📄 CNPJ: ${session.cnpj}` : ""}

⚡ Ação: Entrar em contato no período informado para agendar diagnóstico gratuito (20 min).`;
}

// Chama o LLM com fallback chain
async function callSdrLLM(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  aiProvider?: string | null,
  aiModel?: string | null,
): Promise<string | null> {
  const provider = aiProvider?.toUpperCase();
  const model = aiModel ?? "gpt-4o";

  // maxTokens 1000 (era 600) — mensagens longas do cliente (ex.: áudio transcrito)
  // levam o modelo a preencher mais campos de updateSession + mais balões de texto,
  // e um JSON cortado no meio nunca é parseável. response_format=json_object garante
  // que a OpenAI só devolva JSON sintaticamente válido (sem texto solto antes/depois).
  if (provider === "OPENAI" && process.env.OPENAI_API_KEY) {
    const r = await callOpenAI(systemPrompt, history, userMessage, model, { maxTokens: 1000, temperature: 0.7, responseFormat: "json_object" });
    if (r) return r;
  }
  if (provider === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY) {
    const r = await callAnthropic(systemPrompt, history, userMessage, model, { maxTokens: 1000 });
    if (r) return r;
  }
  // Fallback chain
  if (process.env.OPENAI_API_KEY) {
    const r = await callOpenAI(systemPrompt, history, userMessage, "gpt-4o", { maxTokens: 1000, temperature: 0.7, responseFormat: "json_object" });
    if (r) return r;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await callAnthropic(systemPrompt, history, userMessage, "claude-haiku-4-5-20251001", { maxTokens: 1000 });
    if (r) return r;
  }
  if (process.env.GOOGLE_AI_API_KEY) {
    const r = await callGemini(systemPrompt, history, userMessage, "gemini-2.0-flash-lite", { maxTokens: 1000 });
    if (r) return r;
  }
  return null;
}

// Parseia a resposta JSON do LLM de forma resiliente
function parseSdrResponse(raw: string): SDRLLMResponse | null {
  const cleaned = raw.trim();
  // Tenta JSON direto
  try {
    const parsed = JSON.parse(cleaned) as SDRLLMResponse;
    if (Array.isArray(parsed.messages) && parsed.action) return parsed;
  } catch { /* continua */ }
  // Tenta extrair JSON de dentro de markdown
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim()) as SDRLLMResponse;
      if (Array.isArray(parsed.messages) && parsed.action) return parsed;
    } catch { /* continua */ }
  }
  // Tenta encontrar primeiro objeto JSON no texto
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as SDRLLMResponse;
      if (Array.isArray(parsed.messages) && parsed.action) return parsed;
    } catch { /* continua */ }
  }
  return null;
}

// Agenda follow-ups de nutrição (dia 7, 20, 30)
async function scheduleNurtureFollowups(
  conversationId: string,
  phone: string,
  phoneNumberId: string,
  accessToken: string | null | undefined,
): Promise<void> {
  const now = new Date();
  const delays = [7, 20, 30].map((d) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000));

  for (let step = 1; step <= 3; step++) {
    await prisma.conversationFollowUp.upsert({
      where: { conversationId },
      update: { step, status: "ACTIVE", aiMessageAt: now, nextSendAt: delays[step - 1] },
      create: {
        conversationId,
        step,
        status: "ACTIVE",
        aiMessageAt: now,
        nextSendAt: delays[step - 1],
        phoneNumber: phone,
        phoneNumberId,
        accessToken: accessToken ?? undefined,
      },
    });
  }
}

// Agenda follow-up de lead qualificado sem resposta (24h, 48h, 72h)
async function scheduleQualifiedFollowup(
  conversationId: string,
  phone: string,
  phoneNumberId: string,
  accessToken: string | null | undefined,
  leadName: string | null,
): Promise<void> {
  const now = new Date();
  const nextSendAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  await prisma.conversationFollowUp.upsert({
    where: { conversationId },
    update: { step: 1, status: "ACTIVE", aiMessageAt: now, nextSendAt, leadName },
    create: {
      conversationId,
      step: 1,
      status: "ACTIVE",
      aiMessageAt: now,
      nextSendAt,
      leadName,
      phoneNumber: phone,
      phoneNumberId,
      accessToken: accessToken ?? undefined,
    },
  });
}

export async function processSdrResponse(
  conversationId: string,
  userMessage: string,
  agent: {
    id: string;
    aiProvider?: string | null;
    aiModel?: string | null;
    sandboxMode?: boolean;
  },
  incomingMessageId: string,
): Promise<void> {
  const now = new Date();

  // ── Carregar contexto completo ───────────────────────────────────────────────
  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    include: {
      lead: {
        select: { id: true, phoneNumber: true, profileName: true, status: true },
      },
      provider: {
        select: { businessPhoneNumberId: true, accessToken: true, organizationId: true },
      },
    },
  });

  if (!conversation?.lead || !conversation.provider) {
    console.error("[SDR] Conversa não encontrada ou sem lead:", conversationId);
    return;
  }

  // ── Guards de segurança — mesmos do agente padrão ────────────────────────────
  if (conversation.lead.status === "ESCALATED") {
    console.log(`[SDR] Conv ${conversationId} já está ESCALATED — ignorando`);
    return;
  }
  if (conversation.humanTakeover) {
    console.log(`[SDR] humanTakeover=true — ignorando conv ${conversationId}`);
    return;
  }

  const lead = conversation.lead;
  const provider = conversation.provider;
  const phone = lead.phoneNumber;
  const token = provider.accessToken ?? undefined;
  const phoneNumberId = provider.businessPhoneNumberId;

  // ── Debounce ──────────────────────────────────────────────────────────────
  // Espera o cliente terminar de digitar antes de responder. Se uma mensagem
  // mais nova chegar nesse meio-tempo, esta execução aborta — a execução da
  // mensagem mais nova (que vai passar pelo mesmo debounce) responde por todas
  // de uma vez, já que o histórico carregado logo abaixo inclui as anteriores.
  const thisMessage = await prisma.whatsappMessage.findUnique({
    where: { id: incomingMessageId },
    select: { sentAt: true },
  });
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
  if (thisMessage) {
    const newerCount = await prisma.whatsappMessage.count({
      where: { conversationId, role: "USER", sentAt: { gt: thisMessage.sentAt } },
    });
    if (newerCount > 0) {
      console.log(`[SDR] Debounce: mensagem mais nova já chegou — abortando run de ${incomingMessageId}`);
      return;
    }
  }

  if (detectDesinteresse(userMessage)) {
    console.log(`[SDR] Desinteresse/opt-out detectado — encerrando conv ${conversationId}`);
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "BLOCKED" } }).catch(() => {});
    await prisma.conversationFollowUp.updateMany({
      where: { conversationId, status: "ACTIVE" },
      data: { status: "OPT_OUT" },
    }).catch(() => {});
    await cancelFollowUpJobs(conversationId).catch(() => {});
    const session = await loadSdrSession(conversationId);
    await saveSdrSession(conversationId, { ...SDR_EMPTY_SESSION, ...session, mode: "SDR", status: "fora" });
    try {
      await sendWhatsAppMessage(phoneNumberId, phone, "Tudo bem, sem problema. Qualquer coisa é só chamar aqui.", token);
    } catch (e) {
      console.error("[SDR] Erro ao enviar confirmação de opt-out:", e);
    }
    return;
  }

  // ── Carregar sessão SDR ─────────────────────────────────────────────────────
  const session = await loadSdrSession(conversationId);

  // ── Carregar histórico de mensagens (últimas 20) ─────────────────────────────
  const recentMessages = await prisma.whatsappMessage.findMany({
    where: { conversationId },
    orderBy: { sentAt: "desc" },
    take: 20,
    select: { content: true, role: true },
  });

  const history = recentMessages
    .reverse()
    .map((m) => ({
      role: (m.role === "USER" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    }));

  // ── Marcar como lido ──────────────────────────────────────────────────────────
  try {
    const { markWhatsAppMessageRead } = await import("@/lib/whatsapp/send");
    await markWhatsAppMessageRead(phoneNumberId, incomingMessageId, token);
  } catch { /* não crítico */ }

  // ── Construir system prompt ─────────────────────────────────────────────────
  const systemPrompt = buildSdrSystemPrompt(session);

  // ── Chamar LLM ──────────────────────────────────────────────────────────────
  let raw: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    raw = await callSdrLLM(systemPrompt, history, userMessage, agent.aiProvider, agent.aiModel);
    if (raw) break;
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }

  if (!raw) {
    console.error("[SDR] Nenhuma resposta do LLM para conv:", conversationId);
    await notifySdrFailure(conversationId, phoneNumberId, phone, token, provider.organizationId, lead.profileName, "LLM não respondeu após 3 tentativas");
    return;
  }

  const parsed = parseSdrResponse(raw);
  if (!parsed) {
    console.error("[SDR] Falha ao parsear resposta do LLM:", raw.substring(0, 200));
    await notifySdrFailure(conversationId, phoneNumberId, phone, token, provider.organizationId, lead.profileName, `Resposta do LLM não era JSON válido: ${raw.substring(0, 200)}`);
    return;
  }

  // ── Atualizar sessão ─────────────────────────────────────────────────────────
  const newSession: SDRSession = {
    ...SDR_EMPTY_SESSION,
    ...session,
    ...(parsed.updateSession ?? {}),
    mode: "SDR",
  };

  // ── Enviar mensagens em blocos ───────────────────────────────────────────────
  if (!agent.sandboxMode) {
    let bubbleIndex = 0;
    for (const msg of parsed.messages.slice(0, 4)) {
      // Cita (reply-quote) a mensagem do cliente só no primeiro balão da
      // resposta — deixa claro pra quem a IA está respondendo, como um humano.
      const isFirstBubble = bubbleIndex === 0;
      bubbleIndex++;
      const delay = typeof msg.delay === "number" ? msg.delay : 0;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));

      try {
        if (msg.audio) {
          const { gerarESalvarAudioWhatsApp } = await import("@/lib/audio/gerar-audio");
          const enviado = await gerarESalvarAudioWhatsApp(msg.text, conversationId, phoneNumberId, phone, token);
          if (!enviado) {
            // TTS indisponível — cai pra texto em vez de perder o balão
            await sendWhatsAppMessage(phoneNumberId, phone, msg.text, token, isFirstBubble ? incomingMessageId : undefined);
            await prisma.whatsappMessage.create({
              data: { content: msg.text, type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
            }).catch(() => {});
          }
        } else {
          await simulateTypingDelay(phoneNumberId, incomingMessageId, msg.text, phone, token);
          await sendWhatsAppMessage(phoneNumberId, phone, msg.text, token, isFirstBubble ? incomingMessageId : undefined);
          await prisma.whatsappMessage.create({
            data: {
              content: msg.text,
              type: "TEXT",
              role: "ASSISTANT",
              sentAt: new Date(),
              status: "SENT",
              conversationId,
            },
          }).catch(() => {});
        }
      } catch (e) {
        console.error("[SDR] Erro ao enviar mensagem:", e);
      }
    }
  }

  // ── Processar ação ───────────────────────────────────────────────────────────
  switch (parsed.action) {
    case "handoff": {
      newSession.status = "handoff_enviado";
      if (!agent.sandboxMode) {
        const bastao = formatHandoffMessage(phone, newSession);
        await sendWhatsAppMessage(phoneNumberId, HANDOFF_NUMBER, bastao, token).catch((e) =>
          console.error("[SDR] Erro ao enviar bastão:", e)
        );
      }
      const escalatedColumn = await prisma.kanbanColumn.findFirst({
        where: { organizationId: provider.organizationId, type: "ESCALATED" },
      }).catch(() => null);
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: "ESCALATED",
          ...(escalatedColumn ? { kanbanColumnId: escalatedColumn.id } : {}),
          lastActivityAt: now,
        },
      }).catch(() => {});
      await prisma.leadActivity.create({
        data: { leadId: lead.id, type: "STATUS_CHANGE", description: "Lead escalado para especialista pelo SDR", createdBy: "AI_AGENT" },
      }).catch(() => {});
      // Cancela follow-ups pendentes
      await prisma.conversationFollowUp.updateMany({
        where: { conversationId, status: "ACTIVE" },
        data: { status: "DONE" },
      }).catch(() => {});
      console.log(`[SDR] Handoff enviado para ${HANDOFF_NUMBER} | lead=${lead.id} | score=${newSession.score}`);
      break;
    }

    case "nurture": {
      newSession.status = "morno";
      await scheduleNurtureFollowups(conversationId, phone, phoneNumberId, token).catch((e) =>
        console.error("[SDR] Erro ao agendar nutrição:", e)
      );
      console.log(`[SDR] Nutrição agendada | lead=${lead.id} | score=${newSession.score}`);
      break;
    }

    case "close": {
      newSession.status = "fora";
      await prisma.conversationFollowUp.updateMany({
        where: { conversationId, status: "ACTIVE" },
        data: { status: "DONE" },
      }).catch(() => {});
      console.log(`[SDR] Lead encerrado com educação | lead=${lead.id} | score=${newSession.score}`);
      break;
    }

    case "continue":
    default: {
      if (newSession.status === "novo") newSession.status = "em_qualificacao";
      // Agenda follow-up para leads qualificados que param de responder
      if (newSession.score >= 70 && newSession.status !== "handoff_enviado") {
        await scheduleQualifiedFollowup(
          conversationId, phone, phoneNumberId, token, lead.profileName ?? null
        ).catch(() => {});
      } else {
        // Follow-up padrão SDR (24h) para leads em qualificação
        const nextSendAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        await prisma.conversationFollowUp.upsert({
          where: { conversationId },
          update: { step: 1, status: "ACTIVE", aiMessageAt: now, nextSendAt, leadName: lead.profileName ?? null },
          create: {
            conversationId,
            step: 1,
            status: "ACTIVE",
            aiMessageAt: now,
            nextSendAt,
            leadName: lead.profileName ?? null,
            phoneNumber: phone,
            phoneNumberId,
            accessToken: token,
          },
        }).catch(() => {});
      }
      break;
    }
  }

  // ── Salvar sessão atualizada ─────────────────────────────────────────────────
  await saveSdrSession(conversationId, newSession);

  // ── Atualizar lastMessageAt da conversa ──────────────────────────────────────
  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { updatedAt: now },
  }).catch(() => {});

  console.log(`[SDR] ✅ Concluído | conv=${conversationId} | action=${parsed.action} | score=${newSession.score} | etapa=${newSession.etapa}`);
}
