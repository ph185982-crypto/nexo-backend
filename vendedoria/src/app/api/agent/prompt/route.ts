import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

async function getOrCreateConfig() {
  const existing = await prisma.agentConfig.findFirst();
  if (existing) return existing;
  return prisma.agentConfig.create({ data: { currentPrompt: "" } });
}

export async function GET() {
  try {
    const config = await getOrCreateConfig();
    return NextResponse.json({
      content: config.currentPrompt,
      version: config.promptVersion,
      updatedAt: config.updatedAt,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { content, savedBy } = await req.json() as { content: string; savedBy?: string };
    if (!content?.trim()) {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }

    const config = await getOrCreateConfig();

    // 1. Save current version to history before overwriting
    await prisma.agentPromptHistory.create({
      data: {
        content: config.currentPrompt,
        version: config.promptVersion,
        savedBy: savedBy ?? "Pedro",
      },
    });

    // 2. Update current prompt + bump version
    const updated = await prisma.agentConfig.update({
      where: { id: config.id },
      data: {
        currentPrompt: content,
        promptVersion: config.promptVersion + 1,
      },
    });

    return NextResponse.json({
      version: updated.promptVersion,
      updatedAt: updated.updatedAt,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
