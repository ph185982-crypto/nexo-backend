import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const organizationId = searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

  const config = await prisma.aiConfig.findUnique({ where: { organizationId } });

  // Return defaults if not yet configured
  return NextResponse.json(config ?? {
    organizationId,
    usarEmoji: true,
    usarReticencias: true,
    nivelVenda: "medio",
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json() as {
    organizationId: string;
    usarEmoji?: boolean;
    usarReticencias?: boolean;
    nivelVenda?: string;
  };

  const { organizationId, ...data } = body;
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

  const config = await prisma.aiConfig.upsert({
    where: { organizationId },
    update: data,
    create: {
      organizationId,
      usarEmoji: data.usarEmoji ?? true,
      usarReticencias: data.usarReticencias ?? true,
      nivelVenda: data.nivelVenda ?? "medio",
    },
  });

  return NextResponse.json(config);
}
