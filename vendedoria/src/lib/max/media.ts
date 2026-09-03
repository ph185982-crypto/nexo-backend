import { getMediaUrl, downloadMedia } from "@/lib/whatsapp/media";
import { MAX_MEDIA_TIMEOUT_MS } from "./config";

export async function fetchMetaMediaWithTimeout(
  mediaId: string,
  token: string,
): Promise<Buffer> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Media download timeout")), MAX_MEDIA_TIMEOUT_MS)
  );

  const downloadPromise = (async () => {
    const url = await getMediaUrl(mediaId, token);
    return downloadMedia(url, token);
  })();

  return Promise.race([downloadPromise, timeoutPromise]);
}

export const MEDIA_FALLBACK_MSG =
  "📎 Recebi seu comprovante mas não consegui abrir a imagem. Pode reenviar ou me dizer manualmente: qual valor, para quem foi e quando?";

export function buildImageContent(
  buffer: Buffer,
  mimeType: string,
  caption?: string | null,
): Array<{ type: string; [k: string]: unknown }> {
  const parts: Array<{ type: string; [k: string]: unknown }> = [];

  const safeType = ({"image/jpeg":"image/jpeg","image/jpg":"image/jpeg","image/png":"image/png","image/webp":"image/webp"} as Record<string,string>)[mimeType.toLowerCase()] ?? "image/jpeg";

  parts.push({
    type: "image_url",
    image_url: { url: `data:${safeType};base64,${buffer.toString("base64")}` },
  });

  const textInstruction = "Analise este comprovante financeiro. Extraia os valores REAIS e registre com registrar_transacao. NUNCA invente valor.";
  const fullText = caption ? `${caption}\n\n${textInstruction}` : textInstruction;
  parts.push({ type: "text", text: fullText });

  return parts;
}

export function buildDocumentContent(
  buffer: Buffer,
  filename?: string | null,
  caption?: string | null,
): Array<{ type: string; [k: string]: unknown }> {
  const base64 = buffer.toString("base64");
  const parts: Array<{ type: string; [k: string]: unknown }> = [];

  parts.push({
    type: "text",
    text: `[Documento recebido: ${filename ?? "documento.pdf"}]\n\nConteúdo em base64 (${Math.round(base64.length / 1024)}KB). Analise e extraia informações financeiras relevantes.${caption ? `\n\nMensagem do usuário: ${caption}` : ""}`,
  });

  return parts;
}
