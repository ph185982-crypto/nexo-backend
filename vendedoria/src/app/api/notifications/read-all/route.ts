import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function POST(req: NextRequest) {
  const { organizationId } = await req.json();
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

  await prisma.ownerNotification.updateMany({
    where: { organizationId, read: false },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}
