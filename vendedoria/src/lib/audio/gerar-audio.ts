async function gerarAudioElevenLabs(text: string): Promise<Buffer | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM"; // Rachel (default)
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    console.error("[ElevenLabs] TTS failed:", res.status, await res.text());
    return null;
  }

  return Buffer.from(await res.arrayBuffer());
}

async function gerarAudioOpenAI(text: string): Promise<Buffer | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice: "nova",
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    console.error("[OpenAI TTS] failed:", res.status, await res.text());
    return null;
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Gera áudio TTS e retorna os bytes em memória (mp3) — seguro para serverless.
 * Vercel não permite escrever em disco fora de /tmp nem servir arquivos escritos
 * em runtime a partir de /public (o build é imutável), então o caminho correto
 * é enviar os bytes direto pra API de mídia do WhatsApp (uploadWhatsAppMedia)
 * e mandar por media_id — sem depender de nenhuma URL pública própria.
 */
export async function gerarAudioBuffer(text: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  let audioBuffer = await gerarAudioElevenLabs(text);
  if (audioBuffer) return { buffer: audioBuffer, mimeType: "audio/mpeg" };

  console.log("[gerarAudio] ElevenLabs indisponível — tentando OpenAI TTS");
  audioBuffer = await gerarAudioOpenAI(text);
  if (audioBuffer) return { buffer: audioBuffer, mimeType: "audio/mpeg" };

  console.error("[gerarAudio] Nenhum provedor TTS disponível");
  return null;
}

/**
 * Gera o áudio e já envia pro cliente via WhatsApp, salvando a mensagem no CRM
 * com o media_id em `mediaUrl` (mesmo esquema usado para áudio recebido) — assim
 * o áudio que a IA mandou também fica ouvível no painel de conversas.
 */
export async function gerarESalvarAudioWhatsApp(
  text: string,
  conversationId: string,
  phoneNumberId: string,
  to: string,
  accessToken: string | undefined,
): Promise<boolean> {
  const { prisma } = await import("@/lib/prisma/client");
  const { uploadWhatsAppMedia, sendWhatsAppAudioById } = await import("@/lib/whatsapp/send");

  const gerado = await gerarAudioBuffer(text);
  if (!gerado) return false;

  const uploaded = await uploadWhatsAppMedia(phoneNumberId, gerado.buffer, gerado.mimeType, "audio.mp3", accessToken);
  if (!uploaded?.id) {
    console.error("[gerarAudio] Upload pro WhatsApp falhou");
    return false;
  }

  await sendWhatsAppAudioById(phoneNumberId, to, uploaded.id, accessToken);
  await prisma.whatsappMessage.create({
    data: {
      content: `[Áudio TTS] ${text.substring(0, 200)}`,
      type: "AUDIO",
      role: "ASSISTANT",
      sentAt: new Date(),
      status: "SENT",
      mediaUrl: uploaded.id,
      conversationId,
    },
  }).catch(() => {});
  return true;
}
