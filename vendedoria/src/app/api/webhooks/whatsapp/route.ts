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
  try {
    // Verify signature
    const signature = req.headers.get("x-hub-signature-256");
    const body = await req.text();

    if (!verifySignature(body, signature)) {
      console.error("[WhatsApp Webhook] Signature validation failed — check META_WHATSAPP_APP_SECRET");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const data = JSON.parse(body);
    console.log("[WhatsApp Webhook] Payload recebido:", JSON.stringify(data).slice(0, 300));

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
    console.error("[WhatsApp Webhook] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function handleIncomingMessage(
  message: {
    id: string;
    from: string;
    type: string;
    text?: { body: string };
    // Audio / voice fields from WhatsApp Business API
    audio?: { id: string; mime_type?: string };
    voice?: { id: string; mime_type?: string };
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
  } else {
    content = message.text?.body ?? mediaLabels[message.type] ?? `[${message.type}]`;
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
  const alreadyProcessed = await prisma.whatsappMessage.findUnique({ where: { id: message.id } });
  if (alreadyProcessed) return;

  // Save user message
  await prisma.whatsappMessage.create({
    data: {
      id: message.id,
      content,
      type: message.type.toUpperCase() as "TEXT",
      role: "USER",
      sentAt,
      status: "DELIVERED",
      conversationId: conversation.id,
    },
  });

  // Update conversation last message
  await prisma.whatsappConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: sentAt, updatedAt: new Date() },
  });

  // Cancel any active follow-up — user replied, no need to follow up
  await prisma.conversationFollowUp.updateMany({
    where: { conversationId: conversation.id, status: "ACTIVE" },
    data: { status: "DONE" },
  }).catch(() => {});

  // Trigger AI agent if configured — fire-and-forget with explicit error logging
  if (providerConfig.agent?.kind === "AI" && providerConfig.agent?.status === "ACTIVE") {
    console.log("[WhatsApp Webhook] Disparando agente IA para conversa:", conversation.id);
    processAIResponse(conversation.id, content, providerConfig.agent).catch((err) => {
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
