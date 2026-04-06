import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { uploadBase64ToCloudinary } from "@/lib/cloudinary";

/**
 * POST /api/admin/migrate-media
 * Finds all products with base64 media (data: URIs) and uploads them to Cloudinary.
 * Protected by CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const products = await prisma.product.findMany({
    select: { id: true, name: true, imageUrl: true, imageUrls: true, videoUrl: true },
  });

  const results: Array<{ id: string; name: string; field: string; status: string; url?: string }> = [];

  for (const product of products) {
    // ── imageUrl ────────────────────────────────────────────────────────────
    if (product.imageUrl?.startsWith("data:")) {
      try {
        const r = await uploadBase64ToCloudinary(product.imageUrl, "vendedoria/products");
        await prisma.product.update({ where: { id: product.id }, data: { imageUrl: r.url } });
        results.push({ id: product.id, name: product.name, field: "imageUrl", status: "ok", url: r.url });
      } catch (e) {
        results.push({ id: product.id, name: product.name, field: "imageUrl", status: `error: ${e}` });
      }
    }

    // ── imageUrls[] ─────────────────────────────────────────────────────────
    if (product.imageUrls?.some((u) => u.startsWith("data:"))) {
      const newUrls: string[] = [];
      for (let i = 0; i < product.imageUrls.length; i++) {
        const u = product.imageUrls[i];
        if (u.startsWith("data:")) {
          try {
            const r = await uploadBase64ToCloudinary(u, "vendedoria/products");
            newUrls.push(r.url);
            results.push({ id: product.id, name: product.name, field: `imageUrls[${i}]`, status: "ok", url: r.url });
          } catch (e) {
            newUrls.push(u); // keep original on error
            results.push({ id: product.id, name: product.name, field: `imageUrls[${i}]`, status: `error: ${e}` });
          }
        } else {
          newUrls.push(u);
        }
      }
      await prisma.product.update({ where: { id: product.id }, data: { imageUrls: newUrls } });
    }

    // ── videoUrl ────────────────────────────────────────────────────────────
    if (product.videoUrl?.startsWith("data:")) {
      try {
        const r = await uploadBase64ToCloudinary(product.videoUrl, "vendedoria/products");
        await prisma.product.update({ where: { id: product.id }, data: { videoUrl: r.url } });
        results.push({ id: product.id, name: product.name, field: "videoUrl", status: "ok", url: r.url });
      } catch (e) {
        results.push({ id: product.id, name: product.name, field: "videoUrl", status: `error: ${e}` });
      }
    }
  }

  const migrated = results.filter((r) => r.status === "ok").length;
  const errors   = results.filter((r) => r.status.startsWith("error")).length;

  console.log(`[migrate-media] Done: ${migrated} migrated, ${errors} errors`);
  return NextResponse.json({ migrated, errors, results });
}

/** GET returns summary of base64 media still in DB (dry-run check). */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const products = await prisma.product.findMany({
    select: { id: true, name: true, imageUrl: true, imageUrls: true, videoUrl: true },
  });

  const issues: Array<{ id: string; name: string; field: string; type: string }> = [];

  for (const p of products) {
    if (p.imageUrl?.startsWith("data:"))
      issues.push({ id: p.id, name: p.name, field: "imageUrl", type: p.imageUrl.split(";")[0].replace("data:", "") });
    (p.imageUrls ?? []).forEach((u, i) => {
      if (u.startsWith("data:"))
        issues.push({ id: p.id, name: p.name, field: `imageUrls[${i}]`, type: u.split(";")[0].replace("data:", "") });
    });
    if (p.videoUrl?.startsWith("data:"))
      issues.push({ id: p.id, name: p.name, field: "videoUrl", type: p.videoUrl.split(";")[0].replace("data:", "") });
  }

  return NextResponse.json({ base64Count: issues.length, issues });
}
