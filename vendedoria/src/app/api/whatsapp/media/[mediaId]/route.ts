import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { getMediaUrl } from "@/lib/whatsapp/media";

/**
 * GET /api/whatsapp/media/[mediaId]
 *
 * Proxy that fetches WhatsApp media on demand.
 *
 * WhatsApp CDN URLs expire in ~5 minutes, so we can't store them.
 * Instead we store the raw media_id in WhatsappMessage.mediaUrl and
 * call this proxy from the CRM frontend — it fetches a fresh temp URL
 * from Meta and pipes the bytes back to the browser.
 *
 * The browser receives a 1-hour private cache header so repeated opens
 * of the same conversation don't hammer Meta's API.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  const { mediaId } = await params;

  if (!mediaId || mediaId.length < 5) {
    return NextResponse.json({ error: "Invalid media ID" }, { status: 400 });
  }

  console.log(`[MediaProxy] Solicitando media_id=${mediaId}`);

  try {
    // ── Resolve access token ──────────────────────────────────────────────────
    // Look up the provider config that owns a message with this mediaId so we
    // use the correct per-account token (falls back to the global env token).
    let accessToken: string | null | undefined =
      process.env.META_WHATSAPP_ACCESS_TOKEN;

    const msg = await prisma.whatsappMessage.findFirst({
      where: { mediaUrl: mediaId },
      select: {
        conversation: {
          select: {
            provider: { select: { accessToken: true } },
          },
        },
      },
    });

    const providerToken = msg?.conversation?.provider?.accessToken;
    if (providerToken) accessToken = providerToken;

    if (!accessToken) {
      console.error(`[MediaProxy] Nenhum token para media_id=${mediaId}`);
      return NextResponse.json({ error: "No access token configured" }, { status: 503 });
    }

    // ── Fetch temp CDN URL from Meta ─────────────────────────────────────────
    const tempUrl = await getMediaUrl(mediaId, accessToken);
    console.log(`[MediaProxy] media_id=${mediaId} → CDN URL obtida (${tempUrl.slice(0, 60)}…)`);

    // ── Proxy bytes from Meta CDN ────────────────────────────────────────────
    const upstream = await fetch(tempUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!upstream.ok) {
      console.error(
        `[MediaProxy] CDN fetch falhou: ${upstream.status} para media_id=${mediaId}`
      );
      return NextResponse.json({ error: "Media fetch failed" }, { status: 502 });
    }

    const contentType =
      upstream.headers.get("content-type") ?? "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      // Cache privately in browser for 1 hour to avoid repeated Meta API calls
      "Cache-Control": "private, max-age=3600",
    };
    if (contentLength) headers["Content-Length"] = contentLength;

    console.log(`[MediaProxy] Streaming media_id=${mediaId} | type=${contentType} | size=${contentLength ?? "?"}B`);

    // Stream body directly — avoids buffering large videos in server memory
    return new NextResponse(upstream.body, { headers });
  } catch (err) {
    console.error(`[MediaProxy] Erro para media_id=${mediaId}:`, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
