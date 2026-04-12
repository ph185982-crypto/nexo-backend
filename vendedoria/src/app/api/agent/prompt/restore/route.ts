import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function POST(req: NextRequest) {
  try {
    const { version } = await req.json() as { version: number };
    const historical = await prisma.agentPromptHistory.findFirst({
      where: { version },
    });
    if (!historical) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const config = await prisma.agentConfig.findFirst();
    if (!config) {
      return NextResponse.json({ error: "No AgentConfig found" }, { status: 404 });
    }

    // Save current version to history before restoring
    await prisma.agentPromptHistory.create({
      data: {
        content: config.currentPrompt,
        version: config.promptVersion,
        savedBy: "restore",
      },
    });

    const updated = await prisma.agentConfig.update({
      where: { id: config.id },
      data: {
        currentPrompt: historical.content,
        promptVersion: config.promptVersion + 1,
      },
    });

    return NextResponse.json({
      version: updated.promptVersion,
      restoredFrom: version,
      updatedAt: updated.updatedAt,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
