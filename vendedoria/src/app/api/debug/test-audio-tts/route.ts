/**
 * GET /api/debug/test-audio-tts
 * Gera um áudio de teste via TTS e envia pro número do dono (OWNER_WHATSAPP_NUMBER)
 * usando o mesmo caminho que a IA usa (upload direto pro WhatsApp, sem disco/URL
 * pública). Autenticado por sessão — só pra validar a integração manualmente.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";
import { config } from "@/lib/config/env";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const provider = await prisma.whatsappProviderConfig.findFirst({
    select: { businessPhoneNumberId: true, accessToken: true },
  });
  if (!provider?.businessPhoneNumberId) {
    return NextResponse.json({ error: "Nenhum provider config encontrado" }, { status: 404 });
  }

  const { gerarAudioBuffer } = await import("@/lib/audio/gerar-audio");
  const { uploadWhatsAppMedia, sendWhatsAppAudioById } = await import("@/lib/whatsapp/send");

  const texto = "Oi, aqui é um teste de áudio da Nexo. Se você está me ouvindo, o envio de voz da inteligência artificial está funcionando certinho.";

  const gerado = await gerarAudioBuffer(texto);
  if (!gerado) {
    return NextResponse.json({ ok: false, step: "tts", error: "Nenhum provedor TTS disponível (verifique OPENAI_API_KEY/ELEVENLABS_API_KEY)" }, { status: 502 });
  }

  const uploaded = await uploadWhatsAppMedia(
    provider.businessPhoneNumberId,
    gerado.buffer,
    gerado.mimeType,
    "teste.mp3",
    provider.accessToken ?? undefined,
  );
  if (!uploaded?.id) {
    return NextResponse.json({ ok: false, step: "upload", error: "Falha ao subir o áudio pro WhatsApp" }, { status: 502 });
  }

  try {
    await sendWhatsAppAudioById(
      provider.businessPhoneNumberId,
      config.ownerWhatsapp,
      uploaded.id,
      provider.accessToken ?? undefined,
    );
  } catch (e) {
    return NextResponse.json({ ok: false, step: "send", error: String(e) }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    mediaId: uploaded.id,
    sentTo: config.ownerWhatsapp,
    audioBytes: gerado.buffer.length,
    mimeType: gerado.mimeType,
    message: "Áudio de teste enviado — confira seu WhatsApp",
  });
}
