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
  const body = await req.json();
  const { organizationId, name, description, price, priceInstallments, installments, imageUrl, videoUrl, category } = body;

  if (!organizationId || !name || price == null) {
    return NextResponse.json({ error: "organizationId, name and price are required" }, { status: 400 });
  }

  const product = await prisma.product.create({
    data: {
      organizationId,
      name,
      description: description ?? null,
      price: Number(price),
      priceInstallments: priceInstallments != null ? Number(priceInstallments) : null,
      installments: installments ? Number(installments) : 10,
      imageUrl: imageUrl ?? null,
      videoUrl: videoUrl ?? null,
      category: category ?? null,
      isActive: true,
    },
  });

  return NextResponse.json(product, { status: 201 });
}
