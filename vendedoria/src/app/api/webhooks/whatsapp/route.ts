import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma/client";
import { processAIResponse } from "@/lib/ai/agent";
import { getMediaUrl, downloadMedia } from "@/lib/whatsapp/media";
import { transcribeAudio } from "@/lib/ai/transcription";

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
    timestamp: string;
  },
  contact: { profile?: { name?: string } } | undefined,
  providerConfig: {
    id: string;
    organizationId: string;
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

  const phone = message.from;
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
  } else if (message.type === "location" && message.location) {
    // Extrair coordenadas reais para que a IA reconheça e agradeça a localização
    const loc = message.location;
    const parts = [`[Localização recebida] lat:${loc.latitude} lng:${loc.longitude}`];
    if (loc.address) parts.push(`endereço: ${loc.address}`);
    if (loc.name)    parts.push(`ponto: ${loc.name}`);
    content = parts.join(" | ");
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

  // Find or create lead
  let lead = await prisma.lead.findFirst({
    where: { phoneNumber: phone, organizationId: providerConfig.organizationId },
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

  // Cancel any active follow-up — user replied, no need to follow up
  await prisma.conversationFollowUp.updateMany({
    where: { conversationId: conversation.id, status: "ACTIVE" },
    data: { status: "DONE" },
  }).catch(() => {});

  // Trigger AI agent if configured — fire-and-forget with explicit error logging
  if (providerConfig.agent?.kind === "AI" && providerConfig.agent?.status === "ACTIVE") {
    console.log("[WhatsApp Webhook] Disparando agente IA para conversa:", conversation.id);
    processAIResponse(conversation.id, content, providerConfig.agent, message.id).catch((err) => {
      console.error("[WhatsApp Webhook] AI agent error:", err);
    });
  } else {
    console.log("[WhatsApp Webhook] Agente IA não ativo — kind:", providerConfig.agent?.kind, "| status:", providerConfig.agent?.status);
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
