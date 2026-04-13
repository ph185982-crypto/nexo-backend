import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppImage, sendWhatsAppVideo } from "@/lib/whatsapp/send";
import { uploadToCloudinary, isCloudinaryConfigured } from "@/lib/cloudinary";

function appUrl(req: NextRequest): string {
  return (
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    new URL(req.url).origin
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params;

  // Load conversation + provider
  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    include: { provider: true },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  const { businessPhoneNumberId, accessToken, organizationId } = conversation.provider;
  const to = conversation.customerWhatsappBusinessId;

  let mediaUrl: string;
  let mediaType: "image" | "video" | "document";
  let caption: string | undefined;

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    // ── File upload path ────────────────────────────────────────────────────
    if (!isCloudinaryConfigured()) {
      return NextResponse.json({ error: "Cloudinary não configurado" }, { status: 503 });
    }
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const typeParam = (form.get("type") as string | null) ?? "image";
    caption = (form.get("caption") as string | null) ?? undefined;

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
    }

    const isVideo = file.type.startsWith("video/");
    const isPdf   = file.type === "application/pdf";
    mediaType = isVideo ? "video" : isPdf ? "document" : "image";
    if (typeParam === "video") mediaType = "video";

    const result = await uploadToCloudinary(file, "vendedoria/manual");
    mediaUrl = result.url;

  } else {
    // ── Product media path (JSON body) ──────────────────────────────────────
    const body = await req.json() as { productId?: string; mediaType?: string };
    const { productId, mediaType: mt } = body;

    if (!productId || !mt) {
      return NextResponse.json({ error: "productId e mediaType são obrigatórios" }, { status: 400 });
    }
    mediaType = (mt === "video" ? "video" : "image") as "image" | "video";

    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true, name: true, imageUrl: true, imageUrls: true, videoUrl: true },
    });
    if (!product) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
    }

    caption = product.name;

    if (mediaType === "video") {
      if (!product.videoUrl) {
        return NextResponse.json({ error: "Produto sem vídeo cadastrado" }, { status: 400 });
      }
      // If Cloudinary URL — use directly; otherwise proxy through our API
      mediaUrl = product.videoUrl.startsWith("http")
        ? product.videoUrl
        : `${appUrl(req)}/api/media/product/${product.id}?type=video`;
    } else {
      const imgs = Array.isArray(product.imageUrls) && (product.imageUrls as string[]).length > 0
        ? (product.imageUrls as string[])
        : product.imageUrl ? [product.imageUrl] : [];
      if (imgs.length === 0) {
        return NextResponse.json({ error: "Produto sem imagem cadastrada" }, { status: 400 });
      }
      const firstImg = imgs[0];
      mediaUrl = firstImg.startsWith("http")
        ? firstImg
        : `${appUrl(req)}/api/media/product/${product.id}?idx=0`;
    }
  }

  // ── Save message to DB ──────────────────────────────────────────────────────
  const message = await prisma.whatsappMessage.create({
    data: {
      content: caption ?? (mediaType === "video" ? "[Vídeo]" : "[Imagem]"),
      type: mediaType === "video" ? "VIDEO" : mediaType === "document" ? "DOCUMENT" : "IMAGE",
      role: "ASSISTANT",
      sentAt: new Date(),
      status: "SENDING",
      conversationId,
      mediaUrl,
      caption: caption ?? null,
    },
  });

  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });

  // ── Send via WhatsApp ───────────────────────────────────────────────────────
  try {
    if (mediaType === "video") {
      await sendWhatsAppVideo(businessPhoneNumberId, to, mediaUrl, caption, accessToken ?? undefined);
    } else if (mediaType === "image") {
      await sendWhatsAppImage(businessPhoneNumberId, to, mediaUrl, caption, accessToken ?? undefined);
    } else {
      // document — treat as image for now (WhatsApp document API is different)
      await sendWhatsAppImage(businessPhoneNumberId, to, mediaUrl, caption, accessToken ?? undefined);
    }
    await prisma.whatsappMessage.update({ where: { id: message.id }, data: { status: "SENT" } });
  } catch (err) {
    console.error("[send-media] WhatsApp send failed:", err);
    await prisma.whatsappMessage.update({ where: { id: message.id }, data: { status: "FAILED" } });
    return NextResponse.json({ error: "Falha ao enviar pelo WhatsApp", detail: String(err) }, { status: 502 });
  }

  return NextResponse.json({ success: true, messageId: message.id, message: { ...message, status: "SENT" } });
}
