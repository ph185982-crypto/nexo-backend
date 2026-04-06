import { NextRequest, NextResponse } from "next/server";
import { uploadToCloudinary, isCloudinaryConfigured } from "@/lib/cloudinary";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/3gpp"];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;  // 20 MB
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

export async function POST(req: NextRequest) {
  // ── Verify Cloudinary is configured ──────────────────────────────────────
  if (!isCloudinaryConfigured()) {
    return NextResponse.json(
      {
        error: "Cloudinary não configurado.",
        detail:
          "Adicione CLOUDINARY_CLOUD_NAME e " +
          "(CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET) ou CLOUDINARY_UPLOAD_PRESET " +
          "nas variáveis de ambiente do Render.",
      },
      { status: 503 }
    );
  }

  // ── Parse multipart form ──────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Falha ao ler o formulário." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
  }

  const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
  const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);

  if (!isImage && !isVideo) {
    return NextResponse.json(
      {
        error: "Tipo de arquivo não suportado.",
        detail: `Recebido: ${file.type}. Aceitos: JPG, PNG, WEBP para imagens; MP4, MOV para vídeos.`,
      },
      { status: 415 }
    );
  }

  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    const limitMB = Math.round(maxBytes / 1024 / 1024);
    return NextResponse.json(
      { error: `Arquivo muito grande. Limite: ${limitMB} MB para ${isVideo ? "vídeos" : "imagens"}.` },
      { status: 413 }
    );
  }

  // ── Upload to Cloudinary ──────────────────────────────────────────────────
  try {
    const result = await uploadToCloudinary(file, "vendedoria/products");

    console.log(`[Upload] OK — ${isVideo ? "video" : "image"} → ${result.url}`);

    return NextResponse.json({
      url: result.url,
      publicId: result.publicId,
      storage: "cloudinary",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Upload] Cloudinary error:", message);
    return NextResponse.json({ error: "Falha no upload.", detail: message }, { status: 502 });
  }
}
