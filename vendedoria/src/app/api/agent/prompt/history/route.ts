import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET() {
  try {
    const history = await prisma.agentPromptHistory.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return NextResponse.json(history);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
