import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma/client";
import { processAIResponse } from "@/lib/ai/agent";
import { orchestrateAIDecision } from "@/lib/ai/orchestrator";
import { sendAIResponse } from "@/lib/ai/responder";
import { scheduleFollowUp, cancelFollowUpsForConversation } from "@/lib/queue/followup-queue";
import { getMediaUrl, downloadMedia } from "@/lib/whatsapp/media";
import { notificarNovaMensagem } from "@/lib/push/notificar";
import { transcribeAudio } from "@/lib/ai/transcription";
import { normalizeBrazilianNumber } from "@/lib/whatsapp/send";
import { isManagerNumber, handleManagerMessage } from "@/lib/manager/handler";

// ─── Webhook Verification (GET) ────────────────────────────────────────────
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

// ─── Message Processing (POST) ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const body = await req.text();

  // ── CORREÇÃO 4: Diagnostic log on every incoming webhook ──────────────────
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[WhatsApp Webhook] Error — enqueuing for retry:", error);

    // ── CORREÇÃO 3: Save to retry queue on failure ─────────────────────────
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
  // Normalize WhatsApp message type to GraphQL MessageType enum values.
  // Unknown types (sticker, contacts, reaction, interactive, button) fall back to TEXT
  // so the GraphQL serializer never encounters an invalid enum value.
  const TYPE_MAP: Record<string, string> = {
    text: "TEXT", image: "IMAGE", video: "VIDEO",
    audio: "AUDIO", voice: "AUDIO", document: "DOCUMENT", location: "LOCATION",
  };
  const normalizedType = TYPE_MAP[message.type.toLowerCase()] ?? "TEXT";

  // Always store/lookup the 9-digit normalised number (55 + DDD + 9 + 8 digits).
  // Meta sometimes delivers old 8-digit format (55XX8digits); normalise at entry
  // so both the DB record and the phone column are consistent.
  const phone = normalizeBrazilianNumber(message.from);
  const profileName = contact?.profile?.name;
  const sentAt = new Date(Number(message.timestamp) * 1000);

  // Humanize media type descriptions so AI understands what was received
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
    // audio / voice are handled separately below with Whisper transcription
  };

  // ── Audio transcription ───────────────────────────────────────────────────
  // WhatsApp sends voice notes as type="audio" (recorded in-app) or type="voice".
  // We attempt to transcribe via Whisper so the AI agent reads the actual words.
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
          // Prefix makes it clear to the AI agent this was transcribed from audio
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
    // Extrair coordenadas reais para que a IA reconheça e agradeça a localização.
    // Guard: message.location may be absent in malformed payloads → fallback label ensures
    // content is never null/empty (would break String! GraphQL field → empty chat).
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
    // Extract structured contact data (name + phones) so the CRM can render a card
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
    // Base content from text or media label
    content = message.text?.body ?? mediaLabels[message.type] ?? `[${message.type}]`;

    // If image/video/document has a caption, append it so the AI has context
    const inlineCaption = message.image?.caption ?? message.video?.caption ?? message.document?.caption;
    if (inlineCaption) {
      content = `${content} "${inlineCaption}"`;
    }
  }

  // Extract inbound media_id (image, video, document, sticker) for storage
  // We store the raw media_id — the proxy /api/whatsapp/media/[mediaId] serves it on demand
  const inboundMediaId = message.image?.id ?? message.video?.id ?? message.document?.id ?? message.sticker?.id;
  const inboundCaption = message.image?.caption ?? message.video?.caption ?? message.document?.caption;

  if (inboundMediaId) {
    console.log(`[Webhook] Mídia inbound | type=${message.type} | media_id=${inboundMediaId}`);
  }

  // Find or create lead — OR clause handles existing records stored with old 8-digit format
  let lead = await prisma.lead.findFirst({
    where: {
      organizationId: providerConfig.organizationId,
      OR: [{ phoneNumber: phone }, { phoneNumber: message.from }],
    },
  });

  if (!lead) {
    // Find default kanban column
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
  }

  // Find or create conversation
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

  // Idempotency: skip if this exact message was already processed
  // Uses message.id (Meta's ID) as PK — also catches race conditions via try-catch on create
  const alreadyProcessed = await prisma.whatsappMessage.findUnique({ where: { id: message.id } });
  if (alreadyProcessed) {
    console.log(`[Webhook] Mensagem duplicada ignorada: ${message.id}`);
    return;
  }

  // Save user message — if unique constraint fails (race condition), another worker processed it
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
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint") || msg.includes("unique")) {
      console.log(`[Webhook] Race-condition dedup: mensagem ${message.id} já foi processada por outro worker`);
      return;
    }
    throw e;
  }

  // Persist inbound media_id — fire-and-forget so it never blocks the webhook response
  if (inboundMediaId) {
    prisma.whatsappMessage.update({
      where: { id: savedMessage.id },
      data: {
        mediaUrl: inboundMediaId,
        ...(inboundCaption ? { caption: inboundCaption } : {}),
      },
    }).then(() => {
      console.log(`[Webhook] mediaId persistido: ${inboundMediaId} → msg ${savedMessage.id}`);
    }).catch((e) => {
      console.error(`[Webhook] Erro ao persistir mediaId ${inboundMediaId}:`, e);
    });
  }

  // Push notification — fire-and-forget, never blocks webhook response
  const nomeCliente = conversation.profileName ?? conversation.customerWhatsappBusinessId;
  const preview = content.substring(0, 100) || (normalizedType !== "TEXT" ? `[${normalizedType}]` : "Nova mensagem");
  notificarNovaMensagem(nomeCliente, preview, conversation.id).catch((e) =>
    console.error("[Webhook] Push notification error:", e)
  );

  // Update conversation: lastMessageAt + localizacaoRecebida (se for localização)
  await prisma.whatsappConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: sentAt,
      updatedAt: new Date(),
      ...(message.type === "location" ? { localizacaoRecebida: true } : {}),
    },
  });
  console.log(`[Webhook] Conv ${conversation.id} atualizada | lastMessageAt=${sentAt.toISOString()} | localizacaoRecebida=${message.type === "location"}`);

  // ── Regra de Ouro: qualquer mensagem do lead cancela TODOS os follow-ups ─────
  // Tenta cancelar via BullMQ (se Redis disponível); fallback via DB apenas
  cancelFollowUpsForConversation(conversation.id).catch(() =>
    prisma.conversationFollowUp.updateMany({
      where: { conversationId: conversation.id, status: "ACTIVE" },
      data: { status: "DONE" },
    }).catch(() => {}),
  );

  // Manager command handler
  if (isManagerNumber(phone)) {
    const msgText = message.text?.body ?? content;
    console.log(`[Webhook] Manager message detected | from=${message.from} → routing to manager handler`);
    handleManagerMessage(msgText, providerConfig, message.from).catch((e) =>
      console.error("[Webhook] Manager handler error:", e)
    );
    return;
  }

  if (providerConfig.agent?.kind !== "AI" || providerConfig.agent?.status !== "ACTIVE") {
    console.log("[Webhook] Agent not active — kind:", providerConfig.agent?.kind, "| status:", providerConfig.agent?.status);
    return;
  }

  // ── New AI Flow: Orchestrator (Decision + Prompt Compiler) + Responder ────
  // Runs async so webhook returns 200 immediately to Meta
  handleWithOrchestrator(conversation.id, content, message.id, providerConfig, phone).catch((err) => {
    console.error("[Webhook] Orchestrator flow error — falling back to legacy agent:", err);
    // Fallback: legacy agent as safety net
    processAIResponse(conversation.id, content, providerConfig.agent!, message.id).catch((e) =>
      console.error("[Webhook] Legacy agent error:", e),
    );
  });
}

// ─── Orchestrator Flow ────────────────────────────────────────────────────────

async function handleWithOrchestrator(
  conversationId: string,
  userMessage: string,
  incomingMessageId: string,
  providerConfig: {
    id: string;
    organizationId: string;
    businessPhoneNumberId: string;
    accessToken?: string | null;
    agent: {
      id: string;
      kind: string;
      status: string;
      aiProvider?: string | null;
      aiModel?: string | null;
      sandboxMode?: boolean;
      escalationThreshold?: number | null;
    } | null;
  },
  phoneNumber: string,
): Promise<void> {
  console.log(`[Orchestrator Flow] conv=${conversationId}`);

  // 1. Decide action + compile prompt
  const result = await orchestrateAIDecision({ conversationId, incomingMessage: userMessage });
  if (!result) {
    throw new Error("orchestrateAIDecision returned null");
  }

  console.log(`[Orchestrator Flow] action=${result.action} state=${result.targetState}`);

  const ctx = {
    conversationId,
    phoneNumber,
    phoneNumberId: providerConfig.businessPhoneNumberId,
    incomingMessageId,
    accessToken: providerConfig.accessToken ?? undefined,
    aiProvider: providerConfig.agent?.aiProvider,
    aiModel: providerConfig.agent?.aiModel,
  };

  switch (result.action) {
    case "RESPOND":
      await sendAIResponse(ctx, result, userMessage);
      // After responding, schedule first follow-up
      await scheduleFirstFollowUp(conversationId, phoneNumber, providerConfig);
      break;

    case "FOLLOW_UP":
      // Decision engine says to wait and follow up later — schedule immediately
      await scheduleFirstFollowUp(conversationId, phoneNumber, providerConfig);
      break;

    case "ESCALATE":
      // Escalation is handled inside decision.ts logging; no message sent here
      console.log(`[Orchestrator Flow] ESCALATE — conv ${conversationId}`);
      break;

    case "CLOSE":
      // Mark lead as LOST if conversation should be closed
      console.log(`[Orchestrator Flow] CLOSE — conv ${conversationId}`);
      break;

    case "WAIT":
      console.log(`[Orchestrator Flow] WAIT — no action taken for conv ${conversationId}`);
      break;

    default:
      // Fallback: respond with compiled prompt
      await sendAIResponse(ctx, { ...result, action: "RESPOND" }, userMessage);
  }
}

// ─── Schedule the first follow-up for a conversation ─────────────────────────

async function scheduleFirstFollowUp(
  conversationId: string,
  phoneNumber: string,
  providerConfig: {
    businessPhoneNumberId: string;
    accessToken?: string | null;
  },
): Promise<void> {
  // Skip if Redis not configured — cron fallback handles it
  if (!process.env.REDIS_URL) return;

  try {
    const agentConfig = await prisma.agentConfig.findFirst();
    const hours = (agentConfig?.followUpHours ?? "4,24,48,72").split(",").map(Number).filter(Boolean);
    const firstDelayMs = (hours[0] ?? 4) * 3_600_000;
    const maxSteps = agentConfig?.maxFollowUps ?? 4;
    const now = new Date();

    // Upsert DB record
    await prisma.conversationFollowUp.upsert({
      where: { conversationId },
      update: { step: 1, status: "ACTIVE", aiMessageAt: now, nextSendAt: new Date(Date.now() + firstDelayMs) },
      create: {
        conversationId,
        step: 1,
        status: "ACTIVE",
        aiMessageAt: now,
        nextSendAt: new Date(Date.now() + firstDelayMs),
        phoneNumber,
        phoneNumberId: providerConfig.businessPhoneNumberId,
        accessToken: providerConfig.accessToken ?? undefined,
      },
    });

    // Schedule BullMQ job
    await scheduleFollowUp(
      {
        conversationId,
        step: 1,
        totalSteps: maxSteps,
        phoneNumber,
        phoneNumberId: providerConfig.businessPhoneNumberId,
        accessToken: providerConfig.accessToken ?? undefined,
      },
      firstDelayMs,
    );
  } catch (e) {
    console.warn("[Webhook] Failed to schedule follow-up:", String(e));
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

  await prisma.whatsappMessage.updateMany({
    where: { id: status.id },
    data: { status: newStatus },
  }).catch(() => {}); // Ignore if message not found
}

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.META_WHATSAPP_APP_SECRET;

  // In development without a secret configured, allow requests to ease local testing
  if (!secret) {
    if (process.env.NODE_ENV === "development") return true;
    // In production, reject all requests if secret is not configured
    console.error("[WhatsApp Webhook] META_WHATSAPP_APP_SECRET is not set — rejecting request");
    return false;
  }

  if (!signature) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  // Ensure buffers are the same length before timingSafeEqual to avoid exceptions
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;

  return timingSafeEqual(sigBuf, expBuf);
}
