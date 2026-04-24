import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

// GET /api/agent/settings?agentId=xxx — returns Agent model editable fields
export async function GET(req: NextRequest) {
  try {
    const agentId = new URL(req.url).searchParams.get("agentId");
    if (!agentId) return NextResponse.json({ error: "agentId required" }, { status: 400 });

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, displayName: true, aiProvider: true, aiModel: true, sandboxMode: true, escalationThreshold: true, status: true, kind: true },
    });
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    return NextResponse.json(agent);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// PUT /api/agent/settings — updates Agent model fields (provider, model, sandboxMode, etc.)
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { agentId, id: _id, createdAt: _c, updatedAt: _u, whatsappProviderConfigId: _wp, ...updateData } = body;
    void _id; void _c; void _u; void _wp;

    if (!agentId || typeof agentId !== "string") {
      return NextResponse.json({ error: "agentId required" }, { status: 400 });
    }

    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: updateData,
      select: { id: true, displayName: true, aiProvider: true, aiModel: true, sandboxMode: true, escalationThreshold: true, status: true, kind: true },
    });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
