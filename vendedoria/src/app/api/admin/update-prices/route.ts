import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

/**
 * POST /api/admin/update-prices
 * Updates product prices by partial name match.
 * Protected by CRON_SECRET.
 * Body: [{ nameContains: string, price: number, priceInstallments: number, installments: number }]
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const updates = await req.json() as Array<{
    nameContains: string;
    price: number;
    priceInstallments?: number | null;
    installments?: number | null;
  }>;

  const results = [];
  for (const u of updates) {
    const products = await prisma.product.findMany({
      where: { name: { contains: u.nameContains, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    for (const p of products) {
      await prisma.product.update({
        where: { id: p.id },
        data: {
          price: u.price,
          ...(u.priceInstallments !== undefined && { priceInstallments: u.priceInstallments }),
          ...(u.installments !== undefined && { installments: u.installments }),
        },
      });
      results.push({ id: p.id, name: p.name, price: u.price, priceInstallments: u.priceInstallments, installments: u.installments });
    }
  }

  return NextResponse.json({ updated: results.length, results });
}

/** GET — list all products with prices (dry-run) */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const products = await prisma.product.findMany({
    select: { id: true, name: true, price: true, priceInstallments: true, installments: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ count: products.length, products });
}
