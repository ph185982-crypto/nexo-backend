import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const organizationId = new URL(req.url).searchParams.get("organizationId");
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId required" }, { status: 400 });
  }

  const products = await prisma.product.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(products);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    organizationId?: string;
    name?: string;
    description?: string;
    price?: number | string;
    priceInstallments?: number | string | null;
    installments?: number | string;
    imageUrl?: string | null;
    imageUrls?: string[];
    videoUrl?: string | null;
    category?: string | null;
  };

  const { organizationId, name, description, price, priceInstallments, installments, imageUrl, imageUrls, videoUrl, category } = body;

  if (!organizationId || !name || price == null) {
    return NextResponse.json({ error: "organizationId, name and price are required" }, { status: 400 });
  }

  // Derive imageUrl from imageUrls[0] if not explicitly provided
  const images: string[] = Array.isArray(imageUrls) ? imageUrls.slice(0, 8) : [];
  const primaryImage = imageUrl ?? images[0] ?? null;

  const product = await prisma.product.create({
    data: {
      organizationId,
      name,
      description: description ?? null,
      price: Number(price),
      priceInstallments: priceInstallments != null ? Number(priceInstallments) : null,
      installments: installments ? Number(installments) : 10,
      imageUrl: primaryImage,
      imageUrls: images,
      videoUrl: videoUrl ?? null,
      category: category ?? null,
      isActive: true,
    },
  });

  return NextResponse.json(product, { status: 201 });
}
