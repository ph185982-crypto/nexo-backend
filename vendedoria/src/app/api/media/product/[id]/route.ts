import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

/**
 * GET /api/media/product/[id]?idx=0          → image at index idx
 * GET /api/media/product/[id]?type=video      → video
 *
 * If the stored URL is a base64 data: URI, decode and serve as binary.
 * If it's a real HTTPS URL, redirect to it.
 * Used so WhatsApp Business API (which requires public HTTPS URLs) can
 * fetch images/videos that were uploaded as base64.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type"); // "video" | null
  const idx  = parseInt(searchParams.get("idx") ?? "0", 10);

  const product = await prisma.product.findUnique({
    where: { id },
    select: { imageUrl: true, imageUrls: true, videoUrl: true },
  });

  if (!product) {
    return new NextResponse("Not found", { status: 404 });
  }

  let url: string | null | undefined;
  if (type === "video") {
    url = product.videoUrl;
  } else {
    const imgs = (product as typeof product & { imageUrls?: string[] }).imageUrls;
    url = (imgs && imgs.length > 0) ? (imgs[idx] ?? imgs[0]) : product.imageUrl;
  }

  if (!url) {
    return new NextResponse("Not found", { status: 404 });
  }

  // If it's an actual HTTPS URL, redirect so the client follows directly
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return NextResponse.redirect(url);
  }

  // Decode base64 data URI and serve as binary
  if (url.startsWith("data:")) {
    const commaIdx = url.indexOf(",");
    if (commaIdx === -1) {
      return new NextResponse("Invalid data URI", { status: 500 });
    }
    const meta     = url.substring(5, commaIdx); // e.g. "image/jpeg;base64"
    const mimeType = meta.split(";")[0];          // e.g. "image/jpeg"
    const base64   = url.substring(commaIdx + 1);
    const buffer   = Buffer.from(base64, "base64");

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  }

  return new NextResponse("Unsupported URL format", { status: 500 });
}
