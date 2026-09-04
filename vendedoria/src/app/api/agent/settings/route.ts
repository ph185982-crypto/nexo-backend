import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";

const EDITABLE_FIELDS = [
  "displayName", "aiProvider", "aiModel", "sandboxMode", "escalationThreshold", "status", "kind",
] as const;

// GET /api/agent/settings?agentId=xxx — returns Agent model editable fields
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const agentId = new URL(req.url).searchParams.get("agentId");
    if (!agentId) return NextResponse.json({ error: "agentId required" }, { status: 400 });

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, displayName: true, aiProvider: true, aiModel: true, sandboxMode: true, escalationThreshold: true, status: true, kind: true },
    });
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    return NextResponse.json(agent);
  } catch (e) {
    if (e instanceof Error && e.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// PUT /api/agent/settings — updates Agent model fields (provider, model, sandboxMode, etc.)
export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json() as Record<string, unknown>;
    const { agentId } = body as { agentId?: string };

    if (!agentId || typeof agentId !== "string") {
      return NextResponse.json({ error: "agentId required" }, { status: 400 });
    }

    // Whitelist explicito — nunca repassar o body inteiro pro Prisma (evita
    // sobrescrever campos como whatsappProviderConfigId por engano ou por
    // um payload malicioso/malformado).
    const updateData: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in body) updateData[field] = body[field];
    }
    if ("sandboxMode" in updateData && typeof updateData.sandboxMode !== "boolean") {
      return NextResponse.json({ error: "sandboxMode must be boolean" }, { status: 400 });
    }
    if ("escalationThreshold" in updateData && typeof updateData.escalationThreshold !== "number") {
      return NextResponse.json({ error: "escalationThreshold must be a number" }, { status: 400 });
    }

    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: updateData,
      select: { id: true, displayName: true, aiProvider: true, aiModel: true, sandboxMode: true, escalationThreshold: true, status: true, kind: true },
    });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof Error && e.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
