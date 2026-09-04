import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { organizationId } = await req.json();
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

  await prisma.ownerNotification.updateMany({
    where: { organizationId, read: false },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}
