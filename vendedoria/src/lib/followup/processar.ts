// Processador de follow-ups vencidos. Vivia dentro de /api/cron/followup e só
// podia ser acionado por HTTP com CRON_SECRET — que nunca foi configurado no
// GitHub (log de 29/10: "Secret CRON_SECRET não configurado"), e o agendamento
// do GitHub roda ~5x/dia, não a cada 10 min. Agora é uma função: o cron chama,
// o webhook chama, /api/health (rotina de hora em hora) chama, e as telas do
// CRM abertas chamam (ver lib/followup/gatilho.ts). Nenhum segredo envolvido.
import { prisma } from "@/lib/prisma/client";
import { alertarCotaEsgotada, ehErroDeCota } from "@/lib/ai/alerta-cota";
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsapp/send";
import { planejarEnvio, proximoEnvio, templateFollowup } from "@/lib/followup/janela";
import { promptFollowupSdr, fallbackFollowupSdr, primeiroNome } from "@/lib/followup/conteudo";
import { loadSdrSession } from "@/lib/ai/sdr/session";
import { moverLeadPorTipo } from "@/lib/crm/pipeline-mover";
import { MAX_FOLLOWUPS, dataDoToque } from "@/lib/followup/cadencia";

const DEFAULT_FOLLOWUP_PROMPT = `Você é um vendedor fazendo follow-up com um cliente que parou de responder.

Escreva UMA mensagem curta (máximo 2 frases), no estilo WhatsApp — informal, sem formalidade, sem "certamente", sem "prezado".
A mensagem deve ser única, personalizada para esse cliente específico, baseada no histórico da conversa.

Cada etapa tem um tom diferente:
- Etapa 1 (cedo): toca leve, pergunta se ficou alguma dúvida, sem pressão
- Etapa 2 (1 dia): traz um benefício específico que ainda não foi mencionado ou que resolveria a objeção
- Etapa 3 (2 dias): usa prova social ou urgência (estoque, clientes que compraram), ainda sem desespero
- Etapa 4+: encerra com porta aberta, sem pressão — agradece o interesse

Regras:
- Mensagem curta, máximo 2 frases
- Use o nome do cliente se souber
- Baseie-se no que o cliente disse antes
- Não repita o mesmo argumento que já não funcionou
- Tom humano, natural, como um vendedor real escreveria
- Responda APENAS a mensagem de follow-up, sem explicação`;

async function generateFollowupMessage(
  step: number,
  totalSteps: number,
  agentName: string,
  customPrompt: string | null,
  leadName: string | null,
  conversationHistory: Array<{ role: string; content: string }>,
): Promise<string | null> {
  const systemPrompt = customPrompt?.trim() || DEFAULT_FOLLOWUP_PROMPT;

  const stepFraction = totalSteps <= 1 ? 1 : step / totalSteps;
  let stepDesc: string;
  if (step === 1) stepDesc = "Etapa 1 — toque leve, pergunta se ficou dúvida";
  else if (stepFraction < 0.5) stepDesc = `Etapa ${step} — benefício novo ou argumento para a objeção`;
  else if (stepFraction < 0.85) stepDesc = `Etapa ${step} — prova social ou urgência leve`;
  else stepDesc = `Etapa ${step} (última) — encerramento com porta aberta, sem pressão`;

  const historyText = conversationHistory
    .slice(-10)
    .map((m) => `${m.role === "USER" ? "Cliente" : agentName}: ${m.content}`)
    .join("\n");

  const userPrompt =
    `${stepDesc}\n` +
    (leadName ? `Nome do cliente: ${leadName}\n` : "") +
    `\nHistórico recente:\n${historyText}\n\nEscreva a mensagem de follow-up:`;

  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          max_tokens: 120,
          temperature: 0.9,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      } else {
        const texto = await res.text();
        if (ehErroDeCota(texto)) void alertarCotaEsgotada("OpenAI", texto);
      }
    } catch (e) { console.error("[FollowUp] OpenAI error:", e); }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", system: systemPrompt, messages: [{ role: "user", content: userPrompt }], max_tokens: 120 }),
      });
      if (res.ok) {
        const data = await res.json() as { content?: Array<{ text?: string }> };
        const text = data.content?.[0]?.text?.trim();
        if (text) return text;
      }
    } catch (e) { console.error("[FollowUp] Anthropic error:", e); }
  }

  if (process.env.GOOGLE_AI_API_KEY) {
    try {
      const model = "gemini-2.0-flash-lite";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { maxOutputTokens: 120, temperature: 0.9 },
        }),
      });
      if (res.ok) {
        const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      }
    } catch (e) { console.error("[FollowUp] Gemini error:", e); }
  }

  return null;
}

function fallbackFollowupMessage(step: number, totalSteps: number, name: string | null): string[] {
  const isLast = step >= totalSteps;
  if (step === 1) return [
    "oi! ficou alguma dúvida?",
    "pode perguntar à vontade 😊",
  ];
  if (step === 2) return [
    "lembrei de você",
    "qualquer coisa que quiser saber é só chamar",
    "tô por aqui 👊",
  ];
  if (isLast) return [
    "tudo bem, não vou mais te incomodar 😄",
    "se um dia precisar",
    name ? `pode me chamar que a gente resolve — abraço ${name}! 👊` : "pode me chamar que a gente resolve — abraço! 👊",
  ];
  return [
    "ainda tenho unidades disponíveis",
    "mas o estoque tá acabando essa semana",
    "consegue fechar hoje?",
  ];
}


/**
 * A janela de 24h fechou e não há template configurado: não dá mais para falar
 * com o lead por mensagem automática. Encerra o follow-up e avisa o dono no CRM
 * (notificação), para ele ligar — o lead não some em silêncio.
 */
async function encerrarSemCanal(
  followUpId: string,
  conversationId: string,
  leadName: string | null,
  telefone: string,
  step?: number,
  motivo?: { titulo: string; corpo: string },
): Promise<void> {
  await prisma.conversationFollowUp.update({
    where: { id: followUpId },
    data: { status: "DONE", ...(step ? { step } : {}) },
  }).catch(() => {});
  const conv = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    select: { leadId: true, provider: { select: { organizationId: true } } },
  }).catch(() => null);
  if (!conv) return;
  await prisma.ownerNotification.create({
    data: {
      type: "INFO",
      title: motivo?.titulo ?? `📞 Lead parou de responder — ligue para ${leadName ?? telefone}`,
      body: motivo?.corpo ?? `A janela de 24h do WhatsApp fechou e ${templateFollowup() ? "o template falhou" : "não há template de follow-up configurado (FOLLOWUP_TEMPLATE_NAME)"}. ` +
        `Mensagem automática não chega mais. Telefone: +${telefone}.`,
      organizationId: conv.provider.organizationId,
      leadId: conv.leadId,
      conversationId,
    },
  }).catch(() => {});
  console.log(`[FollowUp] Janela fechada sem template — dono avisado | conv ${conversationId}`);
}

export interface ResultadoFollowups { checked: number; sent: number; closed: number; errors: number }

/**
 * Envia os follow-ups cuja hora chegou. Claim atômico com lease de 15 min por
 * item, então pode rodar em paralelo (cron + webhook + health) sem duplicar
 * mensagem. `orcamentoMs` limita o tempo total (padrão 50s, o cron tem 60s).
 */
export async function processarFollowupsVencidos(opts: { orcamentoMs?: number } = {}): Promise<ResultadoFollowups> {
  const inicio = Date.now();
  const orcamento = opts.orcamentoMs ?? 50_000;
  const now = new Date();
  const results = { checked: 0, sent: 0, closed: 0, errors: 0 };

  // Load AgentConfig for dynamic intervals, maxFollowUps, followUpPrompt, agentName
  const agentConfig = await prisma.agentConfig.findFirst().catch(() => null);
  const maxFollowUps = MAX_FOLLOWUPS;
  const followUpPrompt = (agentConfig as typeof agentConfig & { followUpPrompt?: string | null })?.followUpPrompt ?? null;
  const agentName = agentConfig?.agentName ?? "Pedro";

  // Claim atômico com lease: empurra nextSendAt 15 min pra frente ao pegar o
  // item, então uma execução concorrente (outro cron, ou o gatilho oportunista
  // do webhook) não pega o mesmo e o cliente não recebe follow-up duplicado.
  // Se a invocação morrer no meio, o lease vence e o item volta a ser elegível.
  const due = await prisma.$queryRaw<Array<{
    id: string;
    conversationId: string;
    step: number;
    leadName: string | null;
    phoneNumber: string;
    phoneNumberId: string;
    accessToken: string | null;
    aiMessageAt: Date;
  }>>`
    UPDATE "ConversationFollowUp"
       SET "nextSendAt" = NOW() + INTERVAL '15 minutes'
     WHERE id IN (
       SELECT id FROM "ConversationFollowUp"
        WHERE status = 'ACTIVE' AND "nextSendAt" <= NOW()
        ORDER BY "nextSendAt" ASC
        LIMIT 50
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, "conversationId", step, "leadName",
              "phoneNumber", "phoneNumberId", "accessToken", "aiMessageAt"
  `;

  results.checked = due.length;

  for (const fu of due) {
    // Deixa ~10s de folga pro fim da invocação. Os itens já reservados que
    // não deram tempo ficam com o lease de 15 min e voltam a ser elegíveis
    // quando ele vencer.
    if (Date.now() - inicio > orcamento) {
      console.warn(`[FollowUp] Orçamento de tempo esgotado — ${results.sent} enviados, restam itens para a próxima execução`);
      break;
    }
    try {
      // Não perturbar quem já saiu do fluxo automático. Sem este guard o bot
      // mandava "oi! ficou alguma dúvida?" para um lead que já estava em
      // conversa com o especialista, ou por cima de um atendimento humano.
      const conv = await prisma.whatsappConversation.findUnique({
        where: { id: fu.conversationId },
        select: { humanTakeover: true, lead: { select: { status: true } } },
      }).catch(() => null);

      const leadStatus = conv?.lead?.status;
      if (conv?.humanTakeover || (leadStatus && ["ESCALATED", "BLOCKED", "CLOSED"].includes(leadStatus))) {
        await prisma.conversationFollowUp.update({
          where: { id: fu.id }, data: { status: "DONE" },
        }).catch(() => {});
        console.log(`[FollowUp] Pulado (lead ${leadStatus ?? "humanTakeover"}) — conv ${fu.conversationId}`);
        results.closed++;
        continue;
      }

      const messages = await prisma.whatsappMessage.findMany({
        where: { conversationId: fu.conversationId },
        orderBy: { sentAt: "desc" },
        take: 15,
        select: { role: true, content: true, sentAt: true },
      });
      const ultimaDoCliente = messages.find((m) => m.role === "USER")?.sentAt ?? null;
      const history = messages.reverse().map((m) => ({ role: m.role, content: m.content }));

      // SDR (B2B): conteúdo a partir do que já foi qualificado, nunca o texto de e-commerce
      const agenteConv = await prisma.whatsappConversation.findUnique({
        where: { id: fu.conversationId },
        select: { provider: { select: { agent: { select: { systemPrompt: true } } } } },
      }).catch(() => null);
      const ehSdr = !!agenteConv?.provider?.agent?.systemPrompt?.trimStart().startsWith("[SDR]");
      const sessaoSdr = ehSdr ? await loadSdrSession(fu.conversationId).catch(() => null) : null;

      // Lead que já ouviu "vamos te chamar" não recebe "ficou alguma dúvida?":
      // quem precisa agir é o dono. Encerra a sequência e avisa para ligar.
      if (sessaoSdr?.etapa === "encerramento_handoff") {
        await encerrarSemCanal(fu.id, fu.conversationId, fu.leadName, fu.phoneNumber, undefined, {
          titulo: `📞 Ligação combinada — ligue para ${sessaoSdr.nome || fu.leadName || fu.phoneNumber}`,
          corpo: `O lead combinou uma ligação${sessaoSdr.disponibilidade ? ` (${sessaoSdr.disponibilidade})` : ""} mas ainda não foi passado ao especialista. Telefone: +${fu.phoneNumber}.`,
        });
        results.closed++;
        continue;
      }

      // Janela de 24h: texto livre só dentro dela; fora, só template aprovado.
      const plano = planejarEnvio(ultimaDoCliente, new Date());
      const token = fu.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN ?? undefined;

      if (plano.modo === "sem_canal") {
        await encerrarSemCanal(fu.id, fu.conversationId, fu.leadName, fu.phoneNumber);
        results.closed++;
        continue;
      }

      if (plano.modo === "template") {
        const nome = primeiroNome(sessaoSdr?.nome ?? fu.leadName) ?? "tudo bem";
        const components = plano.template.comNome ? [{ type: "body", parameters: [{ type: "text", text: nome }] }] : [];
        const wamid = await sendWhatsAppTemplate(fu.phoneNumberId, fu.phoneNumber, plano.template.nome, plano.template.idioma, components, token);
        await prisma.whatsappMessage.create({
          data: { content: `📤 Follow-up ${fu.step} (template "${plano.template.nome}")`, type: "TEXT", role: "ASSISTANT", sentAt: now, status: "SENT", conversationId: fu.conversationId, ...(wamid ? { wamid } : {}) },
        });
      } else {
        const aiMsg = ehSdr
          ? await generateFollowupMessage(fu.step, maxFollowUps, agentName, promptFollowupSdr(fu.step, maxFollowUps, sessaoSdr), sessaoSdr?.nome || fu.leadName, history)
          : await generateFollowupMessage(fu.step, maxFollowUps, agentName, followUpPrompt, fu.leadName, history);
        const msgs: string[] = aiMsg
          ? [aiMsg]
          : ehSdr ? [fallbackFollowupSdr(fu.step, maxFollowUps, sessaoSdr?.nome || fu.leadName)] : fallbackFollowupMessage(fu.step, maxFollowUps, fu.leadName);
        if (!msgs.length) continue;

        for (let i = 0; i < msgs.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, 800));
          const wamid = await sendWhatsAppMessage(fu.phoneNumberId, fu.phoneNumber, msgs[i], token);
          await prisma.whatsappMessage.create({
            data: { content: msgs[i], type: "TEXT", role: "ASSISTANT", sentAt: now, status: "SENT", conversationId: fu.conversationId, ...(wamid ? { wamid } : {}) },
          });
        }
      }

      // Funil Nexo: follow-up conta como novo toque → 2º/3º Contato.
      // Só vale para prospecção outbound. A org do SDR também é tipo
      // PROSPECCAO, então sem checar o agente um lead inbound que estava em
      // "Em qualificação"/"Mornos" era jogado para "2º Contato" — coluna de
      // outro funil — e sumia do board onde o dono acompanha o SDR.
      const convInfo = await prisma.whatsappConversation.findUnique({
        where: { id: fu.conversationId },
        select: {
          leadId: true,
          provider: {
            select: {
              organization: { select: { id: true, tipo: true } },
              agent: { select: { systemPrompt: true } },
            },
          },
        },
      }).catch(() => null);
      const isSdrConversation = !!convInfo?.provider?.agent?.systemPrompt
        ?.trimStart().startsWith("[SDR]");
      if (!isSdrConversation && convInfo?.provider?.organization?.tipo === "PROSPECCAO" && convInfo.leadId) {
        await moverLeadPorTipo(
          convInfo.leadId,
          convInfo.provider.organization.id,
          fu.step === 1 ? "CONTATO_2" : "CONTATO_3",
          `Follow-up ${fu.step} enviado`,
        );
      }

      if (fu.step >= maxFollowUps) {
        await prisma.conversationFollowUp.update({ where: { id: fu.id }, data: { status: "DONE", step: fu.step + 1 } });
        results.closed++;
      } else {
        const nextStep = fu.step + 1;
        // Cadência fixa 2h/12h/24h/48h, sempre contada da mensagem da IA que abriu a sequência.
        const desejado = dataDoToque(nextStep, fu.aiMessageAt);
        // Sem template, o próximo toque precisa caber na janela de 24h — se não
        // couber, encerra e avisa o dono para ligar (nenhum lead some em silêncio).
        const nextSendAt = proximoEnvio(desejado, ultimaDoCliente, new Date());
        if (nextSendAt) {
          await prisma.conversationFollowUp.update({ where: { id: fu.id }, data: { step: nextStep, nextSendAt } });
        } else {
          await encerrarSemCanal(fu.id, fu.conversationId, fu.leadName, fu.phoneNumber, nextStep);
        }
      }

      results.sent++;
    } catch (err) {
      console.error("[FollowUp] Error sending to", fu.phoneNumber, err);
      results.errors++;
    }
  }

  return results;
}
