import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json() as {
    name?: string;
    description?: string;
    price?: number | string;
    priceInstallments?: number | string | null;
    installments?: number | string;
    imageUrl?: string | null;
    imageUrls?: string[];
    videoUrl?: string | null;
    category?: string | null;
    isActive?: boolean;
  };

  const { name, description, price, priceInstallments, installments, imageUrl, imageUrls, videoUrl, category, isActive } = body;

  // If imageUrls array is being updated, sync imageUrl to first element
  const images = Array.isArray(imageUrls) ? imageUrls.slice(0, 8) : undefined;
  const primaryImage = images !== undefined
    ? (imageUrl ?? images[0] ?? null)
    : imageUrl;

  const product = await prisma.product.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(price !== undefined && { price: Number(price) }),
      ...(priceInstallments !== undefined && { priceInstallments: priceInstallments != null ? Number(priceInstallments) : null }),
      ...(installments !== undefined && { installments: Number(installments) }),
      ...(primaryImage !== undefined && { imageUrl: primaryImage }),
      ...(images !== undefined && { imageUrls: images }),
      ...(videoUrl !== undefined && { videoUrl }),
      ...(category !== undefined && { category }),
      ...(isActive !== undefined && { isActive }),
    },
  });

  return NextResponse.json(product);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.product.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
