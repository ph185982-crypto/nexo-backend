import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

const AUDIO_DIR = path.join(process.cwd(), "public", "audios");

async function ensureDir() {
  await mkdir(AUDIO_DIR, { recursive: true });
}

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

export async function gerarAudio(text: string): Promise<string | null> {
  const appUrl = (
    process.env.RENDER_EXTERNAL_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : "")
  ).replace(/\/$/, "");

  if (!appUrl) {
    console.error("[gerarAudio] Nenhuma URL pública configurada — não é possível gerar áudio");
    return null;
  }

  let audioBuffer = await gerarAudioElevenLabs(text);
  if (!audioBuffer) {
    console.log("[gerarAudio] ElevenLabs indisponível — tentando OpenAI TTS");
    audioBuffer = await gerarAudioOpenAI(text);
  }

  if (!audioBuffer) {
    console.error("[gerarAudio] Nenhum provedor TTS disponível");
    return null;
  }

  await ensureDir();
  const hash = crypto.createHash("md5").update(text).digest("hex").slice(0, 8);
  const filename = `audio_${Date.now()}_${hash}.mp3`;
  const filepath = path.join(AUDIO_DIR, filename);
  await writeFile(filepath, audioBuffer);

  return `${appUrl}/audios/${filename}`;
}
