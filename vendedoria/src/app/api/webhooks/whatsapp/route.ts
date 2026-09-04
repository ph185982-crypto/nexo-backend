import { NextRequest, NextResponse, after } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma/client";
import { Prisma } from "@prisma/client";
import { processAIResponse } from "@/lib/ai/agent";
import { processSdrResponse } from "@/lib/ai/sdr/agent";
import { cancelFollowUpJobs } from "@/lib/queue/followup-queue";
import { getMediaUrl, downloadMedia } from "@/lib/whatsapp/media";
import { notificarNovaMensagem } from "@/lib/push/notificar";
import { transcribeAudio } from "@/lib/ai/transcription";
import { normalizeBrazilianNumber, brazilianNumberVariants } from "@/lib/whatsapp/send";
import { isManagerNumber, handleManagerMessage, type IncomingMediaInfo } from "@/lib/manager/handler";
import { vincularProspectAoLead } from "@/lib/crm/pipeline-mover";
import { isMaxOwnerNumber } from "@/lib/max/config";
import { handleMaxMessage } from "@/lib/max/responder";
import { drainWebhookQueue, triggerDueFollowups, RETRY_HEADER } from "@/lib/jobs/webhook-queue";
import { acquireAiLock, releaseAiLock } from "@/lib/ai/conversation-lock";

// Trabalho pós-resposta (chamadas de IA, envio de WhatsApp) precisa de mais que o
// default da função para terminar — a Vercel pode congelar a invocação assim que
// a resposta HTTP é enviada, então todo esse trabalho roda dentro de after().
export const maxDuration = 60;

// ─── Webhook Verification (GET) ──────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_WHATSAPP_VERIFY_TOKEN) {
    console.log("[WhatsApp Webhook] Verified");
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ─── Message Processing (POST) ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const body = await req.text();

  // ── CORREÇÃO 4: Diagnostic log on every incoming webhook ─────────────────────
  const ts = new Date().toISOString();
  try {
    const preview = JSON.parse(body);
    const msg = preview?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = msg?.from ?? preview?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.recipient_id ?? "unknown";
    const text = msg?.text?.body ?? msg?.type ?? "(status/other)";
    console.log(`[Webhook] ${ts} | from: ${from} | msg: ${text.slice(0, 50)}`);
  } catch { console.log(`[Webhook] ${ts} | payload unparseable`); }

  try {
    if (!verifySignature(body, signature)) {
      console.error("[WhatsApp Webhook] Signature validation failed — check META_WHATSAPP_APP_SECRET");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const data = JSON.parse(body);

    // Process each entry
    for (const entry of data.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;

        const value = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;

        // Find the WhatsApp provider config
        const providerConfig = await prisma.whatsappProviderConfig.findFirst({
          where: { businessPhoneNumberId: phoneNumberId },
          include: { agent: true },
        });

        if (!providerConfig) {
          console.warn("[WhatsApp Webhook] Nenhum providerConfig para phone_number_id:", phoneNumberId);
          continue;
        }

        console.log("[WhatsApp Webhook] ProviderConfig encontrado:", providerConfig.id, "| Agente:", providerConfig.agent?.kind, providerConfig.agent?.status);

        // Captura o WABA ID real (entry.id) quando ainda não temos um válido —
        // permite puxar o corpo dos templates da Meta depois.
        const wabaIdWebhook = (entry as { id?: string }).id;
        if (wabaIdWebhook && (!providerConfig.wabaId || providerConfig.wabaId === "DEMO_WABA_ID")) {
          await prisma.whatsappProviderConfig.update({
            where: { id: providerConfig.id },
            data: { wabaId: wabaIdWebhook },
          }).catch(() => {});
          console.log("[WhatsApp Webhook] WABA ID capturado do webhook:", wabaIdWebhook);
        }

        // Process messages
        for (const message of value.messages ?? []) {
          await handleIncomingMessage(message, value.contacts?.[0], providerConfig);
        }

        // Process status updates
        for (const status of value.statuses ?? []) {
          await handleStatusUpdate(status);
        }
      }
    }

    // ── Dreno oportunista da fila de retry ───────────────────────────────────
    // O plano Hobby da Vercel só permite 2 crons diários (ambos já em uso), e
    // "1x por dia" deixaria um cliente que caiu na fila esperando horas. Então
    // o próprio tráfego carrega o reprocessamento: cada mensagem recebida
    // drena alguns itens, em after() (fora do caminho da resposta pra Meta).
    // O guard do RETRY_HEADER evita recursão — um retry não dispara outro.
    if (req.headers.get(RETRY_HEADER) !== "1") {
      after(async () => {
        await drainWebhookQueue(5);
        await triggerDueFollowups();
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[WhatsApp Webhook] Error — enqueuing for retry:", error);

    // ── CORREÇÃO 3: Save to retry queue on failure ───────────────────────
    await prisma.webhookQueue.create({
      data: {
        payload: body,
        signature,
        retryAfter: new Date(Date.now() + 30_000), // retry in 30s
      },
    }).catch((e) => console.error("[WebhookQueue] Failed to enqueue:", e));

    // Always return 200 to Meta so it doesn't keep retrying immediately
    return NextResponse.json({ success: true, queued: true });
  }
}

async function handleIncomingMessage(
  message: {
    id: string;
    from: string;
    type: string;
    text?: { body: string };
    audio?:    { id: string; mime_type?: string };
    voice?:    { id: string; mime_type?: string };
    image?:    { id: string; mime_type?: string; caption?: string };
    video?:    { id: string; mime_type?: string; caption?: string };
    document?: { id: string; mime_type?: string; caption?: string; filename?: string };
    sticker?:  { id: string; mime_type?: string; animated?: boolean };
    location?: { latitude: number; longitude: number; name?: string; address?: string };
    contacts?: Array<{
      name?: { formatted_name?: string; first_name?: string; last_name?: string };
      phones?: Array<{ phone?: string; type?: string; wa_id?: string }>;
      emails?: Array<{ email?: string; type?: string }>;
      org?: { company?: string; title?: string };
    }>;
    timestamp: string;
  },
  contact: { profile?: { name?: string } } | undefined,
  providerConfig: {
    id: string;
    organizationId: string;
    businessPhoneNumberId: string;
    accessToken?: string | null;
    agent: {
      id: string;
      systemPrompt?: string | null;
      kind: string;
      status: string;
      aiProvider?: string | null;
      aiModel?: string | null;
    } | null;
  }
) {
  const TYPE_MAP: Record<string, string> = {
    text: "TEXT", image: "IMAGE", video: "VIDEO",
    audio: "AUDIO", voice: "AUDIO", document: "DOCUMENT", location: "LOCATION",
  };
  const normalizedType = TYPE_MAP[message.type.toLowerCase()] ?? "TEXT";

  const phone = normalizeBrazilianNumber(message.from);
  const profileName = contact?.profile?.name;
  const sentAt = new Date(Number(message.timestamp) * 1000);

  const mediaLabels: Record<string, string> = {
    image: "[Imagem recebida]",
    video: "[Vídeo recebido]",
    document: "[Documento recebido]",
    sticker: "[Sticker recebido]",
    location: "[Localização compartilhada]",
    contacts: "[Contato compartilhado]",
    reaction: "[Reação a mensagem]",
    interactive: "[Resposta interativa]",
    button: "[Botão clicado]",
  };

  let content: string;
  const isAudio = message.type === "audio" || message.type === "voice";
  const mediaPayload = message.audio ?? message.voice;

  if (isAudio && mediaPayload?.id) {
    const token =
      providerConfig.accessToken ??
      process.env.META_WHATSAPP_ACCESS_TOKEN;

    if (token) {
      try {
        const mediaUrl = await getMediaUrl(mediaPayload.id, token);
        const audioBuffer = await downloadMedia(mediaUrl, token);
        const transcript = await transcribeAudio(
          audioBuffer,
          mediaPayload.mime_type ?? "audio/ogg"
        );

        if (transcript) {
          content = `[Áudio transcrito]: ${transcript}`;
        } else {
          content = "[Áudio recebido — transcrição indisponível]";
        }
      } catch (err) {
        console.error("[WhatsApp Webhook] Audio transcription failed:", err);
        content = "[Áudio recebido — erro na transcrição]";
      }
    } else {
      content = "[Áudio recebido]";
    }
  } else if (message.type === "location") {
    const loc = message.location;
    if (loc) {
      const parts = [`[Localização recebida] lat:${loc.latitude} lng:${loc.longitude}`];
      if (loc.address) parts.push(`endereço: ${loc.address}`);
      if (loc.name)    parts.push(`ponto: ${loc.name}`);
      content = parts.join(" | ");
    } else {
      content = "[Localização recebida]";
    }
  } else if (message.type === "contacts" && message.contacts?.length) {
    const cards = message.contacts.map((c) => {
      const nome = c.name?.formatted_name ?? c.name?.first_name ?? "Contato";
      const phones = (c.phones ?? []).map((p) => p.phone ?? p.wa_id).filter(Boolean).join(", ");
      const email  = (c.emails ?? [])[0]?.email ?? "";
      const org    = c.org?.company ?? "";
      const parts  = [`[CONTATO_CARD] nome=${JSON.stringify(nome)}`];
      if (phones) parts.push(`phones=${JSON.stringify(phones)}`);
      if (email)  parts.push(`email=${JSON.stringify(email)}`);
      if (org)    parts.push(`org=${JSON.stringify(org)}`);
      return parts.join(" | ");
    });
    content = cards.join("\n");
    console.log(`[Webhook] Contato recebido: ${content.substring(0, 120)}`);
  } else {
    content = message.text?.body ?? mediaLabels[message.type] ?? `[${message.type}]`;
    const inlineCaption = message.image?.caption ?? message.video?.caption ?? message.document?.caption;
    if (inlineCaption) {
      content = `${content} "${inlineCaption}"`;
    }
  }

  const inboundMediaId = message.image?.id ?? message.video?.id ?? message.document?.id ?? message.sticker?.id ?? mediaPayload?.id;
  const inboundCaption = message.image?.caption ?? message.video?.caption ?? message.document?.caption;

  if (inboundMediaId) {
    console.log(`[Webhook] Mídia inbound | type=${message.type} | media_id=${inboundMediaId}`);
  }

  // Busca por todas as grafias do número: `phone` e `message.from` costumam ser
  // a mesma string, então um lead gravado em outro formato (importação de CSV,
  // cadastro manual formatado, legado de 12 dígitos) não era encontrado e o
  // webhook criava um SEGUNDO lead pro mesmo cliente — dois cards no Kanban,
  // histórico partido ao meio e follow-up em dobro.
  let lead = await prisma.lead.findFirst({
    where: {
      organizationId: providerConfig.organizationId,
      phoneNumber: { in: brazilianNumberVariants(message.from) },
    },
    select: {
      id: true,
      phoneNumber: true,
      profileName: true,
      leadOrigin: true,
      organizationId: true,
      kanbanColumnId: true,
      prospectLeadId: true,
    },
  });

  if (!lead) {
    const defaultColumn = await prisma.kanbanColumn.findFirst({
      where: {
        organizationId: providerConfig.organizationId,
        isDefaultEntry: true,
      },
    });

    if (!defaultColumn) {
      console.error("[WhatsApp] No default kanban column found");
      return;
    }

    lead = await prisma.lead.create({
      data: {
        phoneNumber: phone,
        profileName,
        leadOrigin: "INBOUND",
        organizationId: providerConfig.organizationId,
        kanbanColumnId: defaultColumn.id,
      },
    });
    console.log("[WhatsApp Webhook] Novo lead criado:", lead.id, "| telefone:", phone);
    // Prospecção: vincula ao ProspectLead abordado (se existir) pelo telefone
    vincularProspectAoLead(lead.id, providerConfig.organizationId, phone).catch(() => {});
  }

  let conversation = await prisma.whatsappConversation.findFirst({
    where: {
      leadId: lead.id,
      whatsappProviderConfigId: providerConfig.id,
    },
  });

  if (!conversation) {
    conversation = await prisma.whatsappConversation.create({
      data: {
        customerWhatsappBusinessId: phone,
        profileName,
        leadOrigin: "INBOUND",
        leadId: lead.id,
        whatsappProviderConfigId: providerConfig.id,
        lastMessageAt: sentAt,
      },
    });
  }

  // Atualiza ProspectLead ABORDADO → RESPONDEU quando o lead responde
  if ((lead as typeof lead & { prospectLeadId?: string | null })?.prospectLeadId) {
    const plId = (lead as typeof lead & { prospectLeadId?: string | null }).prospectLeadId!;
    prisma.prospectLead.updateMany({
      where: { id: plId, status: "ABORDADO" },
      data: { status: "RESPONDEU" },
    }).catch(() => {});
  }

  // Salva a mensagem. Se já existe (reenvio da Meta, replay da fila de retry,
  // ou outra invocação concorrente), segue adiante em vez de sair: quem decide
  // se a IA responde é a reivindicação de `aiProcessedAt` mais abaixo — a
  // mensagem pode já estar salva justamente porque a execução anterior morreu
  // ANTES de disparar a IA, e nesse caso o cliente ainda está sem resposta.
  let savedMessage;
  try {
    savedMessage = await prisma.whatsappMessage.create({
      data: {
        id: message.id,
        content,
        type: normalizedType,
        role: "USER",
        sentAt,
        status: "DELIVERED",
        conversationId: conversation.id,
      },
    });
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      console.log(`[Webhook] Mensagem ${message.id} já salva — seguindo para checar se a IA já respondeu`);
      savedMessage = await prisma.whatsappMessage.findUnique({ where: { id: message.id } });
      if (!savedMessage) return;
    } else {
      throw e;
    }
  }

  if (inboundMediaId) {
    try {
      await prisma.whatsappMessage.update({
        where: { id: savedMessage.id },
        data: {
          mediaUrl: inboundMediaId,
          ...(inboundCaption ? { caption: inboundCaption } : {}),
        },
      });
      console.log(`[Webhook] mediaId persistido: ${inboundMediaId} → msg ${savedMessage.id}`);
    } catch (e) {
      console.error(`[Webhook] Erro ao persistir mediaId ${inboundMediaId}:`, e);
    }
  }

  const nomeCliente = conversation.profileName ?? conversation.customerWhatsappBusinessId;
  const preview = content.substring(0, 100) || (normalizedType !== "TEXT" ? `[${normalizedType}]` : "Nova mensagem");
  notificarNovaMensagem(nomeCliente, preview, conversation.id).catch((e) =>
    console.error("[Webhook] Push notification error:", e)
  );

  // Não-fatal: se isso lançar (pressão de pool), a exceção subia até o catch do
  // POST e o disparo da IA nunca era agendado — o cliente ficava sem resposta.
  await prisma.whatsappConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: sentAt,
      updatedAt: new Date(),
      ...(message.type === "location" ? { localizacaoRecebida: true } : {}),
    },
  }).catch((e) => console.error(`[Webhook] Falha ao atualizar conv ${conversation.id}:`, e));
  console.log(`[Webhook] Conv ${conversation.id} atualizada | lastMessageAt=${sentAt.toISOString()} | localizacaoRecebida=${message.type === "location"}`);

  await prisma.conversationFollowUp.updateMany({
    where: { conversationId: conversation.id, status: "ACTIVE" },
    data: { status: "DONE" },
  }).catch(() => {});
  await cancelFollowUpJobs(conversation.id).catch(() => {});

  if (isMaxOwnerNumber(phone)) {
    console.log(`[Webhook] Max owner message | from=${phone} → Max assistant`);
    after(() =>
      handleMaxMessage(
        {
          text: message.text?.body ?? content,
          isAudio,
          media: inboundMediaId ? {
            mediaId: inboundMediaId,
            mimeType: message.image?.mime_type ?? message.document?.mime_type ?? "application/octet-stream",
            type: message.type as "image" | "document" | "audio",
            caption: inboundCaption,
            filename: message.document?.filename,
          } : undefined,
        },
        providerConfig,
      ).catch((e) => console.error("[Webhook] Max handler error:", e)),
    );
    return;
  }

  if (isManagerNumber(phone)) {
    console.log(`[Webhook] Manager message detected | from=${phone} → admin handler`);
    const msgText = message.text?.body ?? content;

    let managerMedia: IncomingMediaInfo | undefined;
    if (message.type === "image" && message.image?.id) {
      managerMedia = { mediaId: message.image.id, mimeType: message.image.mime_type ?? "image/jpeg", type: "image" };
    } else if (message.type === "document" && message.document?.id) {
      managerMedia = { mediaId: message.document.id, mimeType: message.document.mime_type ?? "application/pdf", type: "document" };
    }

    after(() =>
      handleManagerMessage(
        msgText,
        { businessPhoneNumberId: providerConfig.businessPhoneNumberId, organizationId: providerConfig.organizationId, accessToken: providerConfig.accessToken },
        phone,
        managerMedia,
      ).catch((e) => console.error("[Webhook] Manager handler error:", e)),
    );
    return;
  }

  if (providerConfig.agent?.kind !== "AI" || providerConfig.agent?.status !== "ACTIVE") {
    console.log("[Webhook] Agent not active — kind:", providerConfig.agent?.kind, "| status:", providerConfig.agent?.status);
    return;
  }

  const agentConfig = providerConfig.agent!;

  // Reivindica o direito de responder esta mensagem. Atômico: se duas
  // invocações concorrentes (reenvio da Meta, replay da fila) chegarem aqui,
  // só uma leva count===1 e o cliente recebe uma única resposta. E como a
  // marca só é gravada AQUI — depois de tudo que podia falhar — um replay de
  // mensagem que ficou sem resposta ainda encontra aiProcessedAt nulo e
  // dispara a IA, em vez de considerar a mensagem "já processada".
  const claim = await prisma.whatsappMessage.updateMany({
    where: { id: message.id, aiProcessedAt: null },
    data: { aiProcessedAt: new Date() },
  }).catch(() => ({ count: 0 }));

  if (claim.count === 0) {
    console.log(`[Webhook] IA já respondeu a ${message.id} — ignorando duplicata`);
    return;
  }

  after(() =>
    runAIFlow(conversation.id, content, message.id, agentConfig).catch((e) =>
      console.error("[Webhook] AI flow error:", e),
    ),
  );
}

async function runAIFlow(
  conversationId: string,
  userMessage: string,
  incomingMessageId: string,
  agent: {
    id: string;
    kind: string;
    status: string;
    systemPrompt?: string | null;
    aiProvider?: string | null;
    aiModel?: string | null;
    sandboxMode?: boolean;
    escalationThreshold?: number | null;
  },
): Promise<void> {
  // SDR mode: systemPrompt starts with "[SDR]" → dedicated qualification agent
  // (processSdrResponse já trava a conversa internamente)
  if (agent.systemPrompt?.trimStart().startsWith("[SDR]")) {
    await processSdrResponse(conversationId, userMessage, agent, incomingMessageId);
    return;
  }

  // Fluxo padrão não tem proteção própria contra duas mensagens do cliente
  // gerando duas respostas em paralelo — trava aqui, do lado de fora, pelo
  // mesmo motivo e mesmo mecanismo do SDR (ver src/lib/ai/conversation-lock.ts).
  const gotLock = await acquireAiLock(conversationId);
  if (!gotLock) {
    console.warn(`[AI Agent] Não consegui a trava de IA pra conv ${conversationId} a tempo — abortando run de ${incomingMessageId}`);
    return;
  }
  try {
    await processAIResponse(conversationId, userMessage, agent, incomingMessageId);
  } finally {
    await releaseAiLock(conversationId);
  }
}

async function handleStatusUpdate(status: { id: string; status: string }) {
  const statusMap: Record<string, string> = {
    sent: "SENT",
    delivered: "DELIVERED",
    read: "READ",
    failed: "FAILED",
  };

  const newStatus = statusMap[status.status];
  if (!newStatus) return;

  // status.id é o wamid da Meta, não o cuid interno — casar por `id` (como era
  // feito antes) nunca encontrava nada e todo aviso de falha de entrega era
  // descartado em silêncio.
  const { count } = await prisma.whatsappMessage.updateMany({
    where: { wamid: status.id },
    data: { status: newStatus },
  }).catch(() => ({ count: 0 }));

  if (count === 0) {
    // Mensagens enviadas antes desta correção não têm wamid gravado — esperado.
    console.log(`[Webhook] Status ${status.status} sem mensagem correspondente (wamid ${status.id})`);
  } else if (newStatus === "FAILED") {
    console.error(`[Webhook] ⚠️ Meta reportou FALHA DE ENTREGA (wamid ${status.id}) — cliente não recebeu`);
  }
}

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.META_WHATSAPP_APP_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "development") return true;
    console.error("[WhatsApp Webhook] META_WHATSAPP_APP_SECRET is not set — rejecting request");
    return false;
  }

  if (!signature) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;

  return timingSafeEqual(sigBuf, expBuf);
}
