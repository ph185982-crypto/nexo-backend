import { NextRequest, NextResponse } from "next/server";

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;  // 8 MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB (fallback base64)

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });

  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");

  if (!isImage && !isVideo) {
    return NextResponse.json(
      { error: "Tipo não suportado. Envie imagem (jpg/png/webp) ou vídeo (mp4)." },
      { status: 415 }
    );
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;

  // ── Cloudinary (preferido — suporta vídeos grandes) ───────────────────────
  if (cloudName && uploadPreset) {
    const cloudForm = new FormData();
    cloudForm.append("file", file);
    cloudForm.append("upload_preset", uploadPreset);
    cloudForm.append("folder", "vendedoria/products");

    const resourceType = isVideo ? "video" : "image";
    const cloudRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
      { method: "POST", body: cloudForm }
    );

    if (!cloudRes.ok) {
      const err = await cloudRes.text();
      console.error("[Upload] Cloudinary error:", err);
      return NextResponse.json({ error: "Cloudinary falhou.", detail: err }, { status: 502 });
    }

    const data = await cloudRes.json() as { secure_url: string; public_id: string };
    return NextResponse.json({ url: data.secure_url, publicId: data.public_id, storage: "cloudinary" });
  }

  // ── Fallback: base64 data URL (sem Cloudinary) ───────────────────────────
  if (isImage && file.size > MAX_IMAGE_SIZE) {
    return NextResponse.json(
      { error: `Imagem muito grande (máx 8 MB). Reduza o arquivo ou configure Cloudinary.` },
      { status: 413 }
    );
  }

  if (isVideo && file.size > MAX_VIDEO_SIZE) {
    return NextResponse.json(
      { error: "Para vídeos acima de 50 MB configure CLOUDINARY_CLOUD_NAME e CLOUDINARY_UPLOAD_PRESET." },
      { status: 413 }
    );
  }

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:${file.type};base64,${base64}`;

  return NextResponse.json({ url: dataUrl, storage: "base64" });
}
