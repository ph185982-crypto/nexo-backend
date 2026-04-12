import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

const DEFAULT_PROMPT = `Você é Léo, vendedor da Nexo Brasil em Goiânia.`;

async function getOrCreateConfig() {
  const existing = await prisma.agentConfig.findFirst();
  if (existing) return existing;
  return prisma.agentConfig.create({
    data: { currentPrompt: DEFAULT_PROMPT },
  });
}

export async function GET() {
  try {
    const config = await getOrCreateConfig();
    // Omit currentPrompt from this endpoint (use /api/agent/prompt for that)
    const { currentPrompt: _p, ...rest } = config;
    return NextResponse.json(rest);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    // Strip read-only fields
    const { currentPrompt: _p, promptVersion: _v, id: _id, createdAt: _c, ...updateData } = body;
    void _p; void _v; void _id; void _c;

    const config = await getOrCreateConfig();
    const updated = await prisma.agentConfig.update({
      where: { id: config.id },
      data: updateData,
    });
    const { currentPrompt: __p, ...rest } = updated;
    void __p;
    return NextResponse.json(rest);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
