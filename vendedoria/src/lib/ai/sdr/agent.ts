import { prisma } from "@/lib/prisma/client";
import { callOpenAI, callAnthropic, callGemini } from "@/lib/ai/llm-client";
import { sendWhatsAppMessage, simulateTypingDelay } from "@/lib/whatsapp/send";
import { detectDesinteresse } from "@/lib/ai/agent";
import { cancelFollowUpJobs } from "@/lib/queue/followup-queue";
import { moverLeadPorTipo } from "@/lib/crm/pipeline-mover";
import { loadSdrSession, saveSdrSession } from "./session";
import { buildSdrSystemPrompt } from "./prompt";
import { type SDRSession, type SDRLLMResponse, SDR_EMPTY_SESSION } from "./types";

const HANDOFF_NUMBER = process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";

// WhatsApp entrega cada mensagem do cliente como um webhook separado. Quando o
// cliente manda 2-3 mensagens seguidas (comum em conversas por celular), cada
// uma dispara sua própria execução do SDR em paralelo — sem essa espera, o
// cliente recebia respostas duplicadas/sobrepostas, uma pra cada mensagem.
//
// IMPORTANTE: cada segundo aqui é um segundo a mais que a invocação serverless
// (e a conexão Prisma dela) fica viva. Em 27/08/26 um valor de 7000ms esgotou
// o pool de conexões do Supabase (connection_limit=1 por instância, mas em
// rajada de mensagens muitas instâncias concorrentes = pool cheio) e derrubou
// o /api/conversations do CRM inteiro. Mantenha esse valor baixo.
const DEBOUNCE_MS = Number(process.env.SDR_DEBOUNCE_MS ?? 1200);

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

// Campos que o LLM pode gravar na sessão. `status` e `mode` ficam de fora de
// propósito: o modelo às vezes devolvia status="handoff_enviado" junto de
// action="continue", e aí nenhum bastão era enviado, o lead não virava
// ESCALATED, mas nos turnos seguintes o próprio modelo lia a sessão e agia como
// se já tivesse passado o contato — lead qualificado perdido em silêncio.
// `status` passou a ser derivado exclusivamente de `parsed.action`, no código.
const CAMPOS_EDITAVEIS_PELO_LLM = [
  "nome", "canais_atuais", "tem_loja_fisica", "faturamento_total",
  "ja_vende_marketplace", "marketplace_atual", "problema_principal", "cnpj",
  "opera_com_equipe", "disponibilidade", "score", "rota", "produto_indicado",
  "objecoes_mencionadas", "etapa",
] as const satisfies ReadonlyArray<keyof SDRSession>;

const CAMPOS_LISTA = ["canais_atuais", "marketplace_atual", "objecoes_mencionadas"] as const;

/**
 * Aplica o updateSession do LLM sobre a sessão atual sem destruir o que já foi
 * coletado. O prompt pede "apenas os campos que mudaram", mas o modelo devolve
 * com frequência o campo vazio ("nome": "") num turno em que o assunto não
 * apareceu — com spread cru isso zerava o dado e o bastão saía com
 * "Nome: não informado" mesmo tendo o nome coletado turnos antes.
 *
 * Listas são unidas em vez de substituídas: `objecoes_mencionadas` carrega o
 * alerta de risco regulatório que o especialista precisa ver no handoff, e ele
 * sumia assim que o modelo mencionava qualquer outra objeção.
 */
function mergeSdrSession(
  atual: SDRSession,
  update: Partial<SDRSession> | undefined,
): SDRSession {
  const merged: SDRSession = { ...SDR_EMPTY_SESSION, ...atual, mode: "SDR" };
  if (!update) return merged;

  for (const campo of CAMPOS_EDITAVEIS_PELO_LLM) {
    const valor = update[campo];
    if (valor === undefined || valor === null) continue;

    if ((CAMPOS_LISTA as readonly string[]).includes(campo)) {
      if (!Array.isArray(valor)) continue;
      const anterior = (merged[campo] as string[] | undefined) ?? [];
      const novos = valor.filter((v): v is string => typeof v === "string" && v.trim() !== "");
      (merged[campo] as string[]) = Array.from(new Set([...anterior, ...novos]));
      continue;
    }

    // String vazia = "não mencionado neste turno", não "apagar o que eu sabia".
    if (typeof valor === "string" && valor.trim() === "") continue;

    (merged[campo] as unknown) = valor;
  }

  return merged;
}

// Formato de handoff enviado ao especialista
export function formatHandoffMessage(phone: string, session: SDRSession): string {
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

// Notifica o especialista sobre um handoff por TODOS os canais disponíveis —
// nunca só WhatsApp.
//
// A API do WhatsApp só aceita mensagem de texto livre pra um número que
// mandou mensagem pro bot nas últimas 24h (janela de atendimento da Meta).
// Se o especialista não conversa com o próprio bot todo dia — o normal —,
// o envio falha com HTTP 400 (erro 131047) e, antes desta correção, esse
// erro era só logado: o lead virava ESCALATED no CRM mas a notificação
// nunca chegava a lugar nenhum, silenciosamente, pra QUALQUER cliente.
//
// Fix: sempre grava um OwnerNotification (aparece na CRM independente de
// canal) e sempre dispara push notification (não depende da janela da
// Meta) — o WhatsApp continua sendo tentado por ser o canal mais imediato,
// mas deixou de ser o único.
export async function notificarHandoff(
  bastao: string,
  phoneNumberId: string,
  token: string | undefined,
  organizationId: string,
  leadId: string,
  conversationId: string,
): Promise<{ whatsappOk: boolean; erroWhatsapp?: string; janelaFechada?: boolean }> {
  let whatsappOk = false;
  let erroWhatsapp: string | undefined;
  let janelaFechada = false;
  try {
    await sendWhatsAppMessage(phoneNumberId, HANDOFF_NUMBER, bastao, token);
    whatsappOk = true;
  } catch (e) {
    erroWhatsapp = e instanceof Error ? e.message : String(e);
    janelaFechada = /131047|24.?hour|re-?engagement/i.test(erroWhatsapp);
    console.error(
      `[SDR] ❌ Falha ao enviar bastão via WhatsApp${janelaFechada ? " (janela de 24h fechada — especialista precisa mandar uma mensagem pro bot pra reabrir)" : ""}:`,
      erroWhatsapp,
    );
  }

  await prisma.ownerNotification.create({
    data: {
      type: "ESCALATION",
      title: whatsappOk ? "🔥 Novo lead escalado" : "🔥 Novo lead escalado (WhatsApp falhou — veja aqui)",
      body: bastao,
      organizationId,
      leadId,
      conversationId,
    },
  }).catch((e) => console.error("[SDR] Falha ao gravar OwnerNotification:", e));

  const { sendPushToAll } = await import("@/lib/push/notificar");
  await sendPushToAll({
    title: whatsappOk ? "🔥 Novo lead escalado" : "🔥 Novo lead escalado — WhatsApp não entregou",
    body: bastao.split("\n").filter(Boolean).slice(0, 3).join(" · ").slice(0, 180),
    url: `/crm/lead/kanban?leadId=${leadId}`,
    tag: `handoff-${leadId}`,
  }).catch((e) => console.error("[SDR] Falha ao enviar push do handoff:", e));

  return { whatsappOk, erroWhatsapp, janelaFechada };
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

/**
 * Valida o objeto vindo do LLM.
 *
 * Duas correções sobre a versão anterior, que exigia `parsed.action` truthy:
 * - Resposta boa sem `action` era descartada nas três tentativas, o cliente
 *   recebia "tive um probleminha" e o dono um alerta falso — mesmo existindo
 *   uma resposta pronta. `action` agora cai para "continue".
 * - `messages: []` passava (Array.isArray([]) é true): nenhum balão era
 *   enviado, o cliente ficava em silêncio total, mas o código seguia movendo
 *   kanban e logando sucesso. Agora exige pelo menos um balão com texto.
 */
function validarRespostaSdr(parsed: SDRLLMResponse | null): SDRLLMResponse | null {
  if (!parsed || !Array.isArray(parsed.messages)) return null;
  const messages = parsed.messages.filter(
    (m) => m && typeof m.text === "string" && m.text.trim() !== "",
  );
  if (messages.length === 0) return null;

  const acoesValidas = ["continue", "handoff", "nurture", "close"];
  const action = acoesValidas.includes(parsed.action) ? parsed.action : "continue";
  return { ...parsed, messages, action };
}

// Parseia a resposta JSON do LLM de forma resiliente
function parseSdrResponse(raw: string): SDRLLMResponse | null {
  const cleaned = raw.trim();
  const candidatos: string[] = [cleaned];

  // JSON dentro de bloco markdown
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) candidatos.push(jsonMatch[1].trim());

  // Primeiro objeto JSON solto no texto
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) candidatos.push(objMatch[0]);

  for (const candidato of candidatos) {
    try {
      const validado = validarRespostaSdr(JSON.parse(candidato) as SDRLLMResponse);
      if (validado) return validado;
    } catch { /* tenta o próximo formato */ }
  }
  return null;
}

// Agenda a nutrição do lead morno — primeiro toque em 7 dias.
//
// Antes isto era um laço de step 1..3 fazendo upsert por `conversationId`, que
// é @unique: as três iterações escreviam NA MESMA LINHA e só a última
// sobrevivia. Na prática a "nutrição de 3 toques em 30 dias" virava uma única
// mensagem daqui a um mês. Os toques seguintes são responsabilidade do cron,
// que avança o step conforme a linha for sendo processada.
async function scheduleNurtureFollowups(
  conversationId: string,
  phone: string,
  phoneNumberId: string,
  accessToken: string | null | undefined,
): Promise<void> {
  const now = new Date();
  const primeiroToque = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await prisma.conversationFollowUp.upsert({
    where: { conversationId },
    update: { step: 1, status: "ACTIVE", aiMessageAt: now, nextSendAt: primeiroToque },
    create: {
      conversationId,
      step: 1,
      status: "ACTIVE",
      aiMessageAt: now,
      nextSendAt: primeiroToque,
      phoneNumber: phone,
      phoneNumberId,
      accessToken: accessToken ?? undefined,
    },
  });
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
  // Respeita o opt-out: o lead pediu para não ser mais contatado, então a IA
  // não volta a puxar conversa. O atendimento humano continua possível pelo CRM.
  if (conversation.lead.status === "BLOCKED") {
    console.log(`[SDR] Lead ${conversation.lead.id} pediu opt-out — IA não responde`);
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
    // O timestamp da Meta vem em SEGUNDOS: duas mensagens digitadas no mesmo
    // segundo ficam com sentAt idêntico. Com `gt` puro nenhuma das duas runs
    // via a outra como mais nova e ambas respondiam — justamente a rajada que
    // o debounce existe pra resolver. O desempate por id cobre o empate: a run
    // mais nova continua, a mais antiga aborta.
    const newerCount = await prisma.whatsappMessage.count({
      where: {
        conversationId,
        role: "USER",
        OR: [
          { sentAt: { gt: thisMessage.sentAt } },
          { sentAt: thisMessage.sentAt, id: { gt: incomingMessageId } },
        ],
      },
    });
    if (newerCount > 0) {
      console.log(`[SDR] Debounce: mensagem mais nova já chegou — abortando run de ${incomingMessageId}`);
      return;
    }
  }

  if (detectDesinteresse(userMessage)) {
    console.log(`[SDR] Desinteresse/opt-out detectado — encerrando conv ${conversationId}`);
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "BLOCKED" } }).catch(() => {});
    // Também tira do funil de trabalho: marcando só o status, o lead que pediu
    // pra não ser mais contatado continuava aparecendo em "Novos"/"Em
    // qualificação" e o dono seguia tentando trabalhar um contato morto.
    await moverLeadPorTipo(
      lead.id, provider.organizationId, "DESCARTADO",
      "Lead pediu para não ser mais contatado (opt-out)", "LOST",
    );
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
  const systemPrompt = buildSdrSystemPrompt(session, lead.profileName);

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
  const newSession = mergeSdrSession(session, parsed.updateSession);

  // Persiste o que foi coletado ANTES de enviar os balões. O envio leva de 12 a
  // 20s (delays + "digitando..."), e se a invocação for cortada nesse meio a
  // sessão nunca era salva: na mensagem seguinte o agente voltava para
  // etapa "boas_vindas" com score 0 e perguntava tudo de novo, apesar da regra
  // do prompt de nunca repetir pergunta já respondida. O status definitivo é
  // gravado no fim, depois de processada a ação.
  await saveSdrSession(conversationId, newSession).catch((e) =>
    console.error("[SDR] Falha ao salvar sessão parcial:", e),
  );

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
        // msg.audio desativado — áudio TTS desabilitado globalmente
        if (false && msg.audio) {
          void msg.audio; // nunca executa
        } else {
          await simulateTypingDelay(phoneNumberId, incomingMessageId, msg.text, phone, token);
          const wamid = await sendWhatsAppMessage(
            phoneNumberId, phone, msg.text, token,
            isFirstBubble ? incomingMessageId : undefined,
          );
          await prisma.whatsappMessage.create({
            data: {
              wamid,
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

      // Reivindica o handoff ANTES de enviar o bastão. O guard lá em cima lê o
      // status no início da run, ~30s antes desta linha — se o lead mandasse
      // outra mensagem nesse meio-tempo, a segunda run passava pelo guard e o
      // especialista recebia "NOVO LEAD" duplicado do mesmo cliente.
      // updateMany condicional é atômico: só uma run leva count===1.
      const claim = await prisma.lead.updateMany({
        where: { id: lead.id, status: { not: "ESCALATED" } },
        data: { status: "ESCALATED", lastActivityAt: now },
      }).catch(() => ({ count: 0 }));

      if (claim.count === 0) {
        console.log(`[SDR] Handoff já realizado para lead=${lead.id} — ignorando duplicata`);
        break;
      }

      if (!agent.sandboxMode) {
        const bastao = formatHandoffMessage(phone, newSession);
        await notificarHandoff(bastao, phoneNumberId, token, provider.organizationId, lead.id, conversationId);
      }
      // Usa o helper em vez de findFirst inline: se a org não tiver a coluna
      // ESCALATED, o helper loga o aviso e tenta o fallback, em vez de deixar o
      // lead marcado como escalado mas visualmente parado na coluna anterior.
      await moverLeadPorTipo(
        lead.id, provider.organizationId, "ESCALATED",
        "Lead escalado para especialista pelo SDR", "QUALIFICADO",
      );
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
      await moverLeadPorTipo(lead.id, provider.organizationId, "MORNO", "Lead qualificado como morno pelo SDR — iniciando nutrição");
      await scheduleNurtureFollowups(conversationId, phone, phoneNumberId, token).catch((e) =>
        console.error("[SDR] Erro ao agendar nutrição:", e)
      );
      console.log(`[SDR] Nutrição agendada | lead=${lead.id} | score=${newSession.score}`);
      break;
    }

    case "close": {
      newSession.status = "fora";
      await moverLeadPorTipo(lead.id, provider.organizationId, "LOST", "Lead fora do ICP — encerrado pelo SDR");
      await prisma.conversationFollowUp.updateMany({
        where: { conversationId, status: "ACTIVE" },
        data: { status: "DONE" },
      }).catch(() => {});
      console.log(`[SDR] Lead encerrado com educação | lead=${lead.id} | score=${newSession.score}`);
      break;
    }

    case "continue":
    default: {
      // Qualquer estado não-terminal volta pra "em qualificação" quando o lead
      // responde de novo. Antes só "novo" era promovido, então um lead marcado
      // "morno" ou "fora" que voltasse a conversar seguia sendo qualificado
      // ativamente mas continuava parado em "Mornos"/"Fora do ICP" no board.
      if (newSession.status !== "handoff_enviado") {
        newSession.status = "em_qualificacao";
      }
      // Reflete a qualificação em andamento no Kanban — moverLeadPorTipo já é
      // idempotente (não faz nada se o lead já está na coluna), seguro chamar
      // a cada turno em vez de só na transição novo→em_qualificacao.
      if (newSession.status === "em_qualificacao") {
        await moverLeadPorTipo(lead.id, provider.organizationId, "EM_QUALIFICACAO");
      }
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
