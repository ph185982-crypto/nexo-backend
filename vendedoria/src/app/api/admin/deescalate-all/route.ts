import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

/**
 * POST /api/admin/deescalate-all
 * Resets all ESCALATED leads to OPEN and clears humanTakeover.
 * Protected by CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Reset all escalated leads to OPEN
  const leadsUpdated = await prisma.lead.updateMany({
    where: { status: "ESCALATED" },
    data: { status: "OPEN" },
  });

  // Clear humanTakeover on all conversations whose lead is now OPEN
  const convsUpdated = await prisma.whatsappConversation.updateMany({
    where: { humanTakeover: true },
    data: { humanTakeover: false },
  });

  return NextResponse.json({
    ok: true,
    leadsResetted: leadsUpdated.count,
    conversationsUnlocked: convsUpdated.count,
  });
}

/**
 * GET /api/admin/deescalate-all
 * Lists escalated conversations (dry-run preview).
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const escalated = await prisma.lead.findMany({
    where: { status: "ESCALATED" },
    select: {
      id: true,
      phoneNumber: true,
      profileName: true,
      status: true,
      conversations: {
        select: { id: true, humanTakeover: true },
      },
    },
  });

  return NextResponse.json({ total: escalated.length, leads: escalated });
}
