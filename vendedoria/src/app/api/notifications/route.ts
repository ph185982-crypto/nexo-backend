import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const organizationId = searchParams.get("organizationId");
  const unreadOnly = searchParams.get("unread") === "true";

  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

  const notifications = await prisma.ownerNotification.findMany({
    where: {
      organizationId,
      ...(unreadOnly ? { read: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(notifications);
}
