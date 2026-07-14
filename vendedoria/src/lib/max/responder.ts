import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { runMaxAgent } from "./loop";
import {
  fetchMetaMediaWithTimeout,
  MEDIA_FALLBACK_MSG,
  buildImageContent,
  buildDocumentContent,
} from "./media";
import { speechTTS } from "./openai";
import { MAX_OWNER_NUMBER, MAX_TTS_MODEL, MAX_TTS_VOICE, MAX_TTS_CHAR_LIMIT, resolveToken } from "./config";
import { uploadWhatsAppMedia, sendWhatsAppAudioById } from "@/lib/whatsapp/send";

export interface MaxMessageInput {
  text?: string;
  isAudio?: boolean;
  media?: {
    mediaId: string;
    mimeType: string;
    type: string;
    caption?: string | null;
    filename?: string | null;
  };
}

export async function handleMaxMessage(
  input: MaxMessageInput,
  providerConfig: { businessPhoneNumberId: string; organizationId: string; accessToken?: string | null },
): Promise<void> {
  const { businessPhoneNumberId, accessToken } = providerConfig;
  const token = resolveToken(accessToken);
  const phone = MAX_OWNER_NUMBER;

  // Log raw webhook event
  await prisma.webhookEventMax.create({
    data: {
      from_number: phone,
      msg_type: input.media?.type ?? (input.isAudio ? "audio" : "text"),
      payload: JSON.parse(JSON.stringify(input)),
    },
  }).catch(e => console.error("[Max] webhook log error:", e));

  const send = async (text: string) => {
    // Break into chunks of 4000 chars
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, 4000));
      remaining = remaining.slice(4000);
    }
    for (const chunk of chunks) {
      await sendWhatsAppMessage(businessPhoneNumberId, phone, chunk, token);
    }
  };

  try {
    let userContent: string | Array<{ type: string; [k: string]: unknown }>;

    // Handle media (image/document)
    if (input.media && (input.media.type === "image" || input.media.type === "document")) {
      try {
        const buffer = await fetchMetaMediaWithTimeout(input.media.mediaId, token);

        if (input.media.type === "image") {
          userContent = buildImageContent(buffer, input.media.mimeType, input.media.caption);
        } else {
          userContent = buildDocumentContent(buffer, input.media.filename, input.media.caption);
        }
      } catch (err) {
        console.error("[Max] Media download failed:", err);
        await send(MEDIA_FALLBACK_MSG);
        return;
      }
    } else {
      // Text or transcribed audio
      userContent = input.text ?? "";
      if (!userContent) {
        console.warn("[Max] Empty message received, skipping");
        return;
      }
    }

    // Run Max agent loop
    const response = await runMaxAgent(userContent);

    // Send text response
    await send(response);

    // If input was audio and response is short, also send audio
    if (input.isAudio && response.length <= MAX_TTS_CHAR_LIMIT) {
      try {
        const audioBuffer = await speechTTS(response, MAX_TTS_VOICE, MAX_TTS_MODEL);
        const mediaResult = await uploadWhatsAppMedia(
          businessPhoneNumberId,
          audioBuffer,
          "audio/ogg",
          "max-reply.opus",
          token,
        );
        if (mediaResult?.id) {
          await sendWhatsAppAudioById(businessPhoneNumberId, phone, mediaResult.id, token);
        }
      } catch (err) {
        console.error("[Max] TTS/audio send failed (text already sent):", err);
      }
    }
  } catch (err) {
    console.error("[Max] handleMaxMessage error:", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    await send(`⚠️ Erro Max: ${errMsg.slice(0, 300)}`).catch(() => {});
  }
}
