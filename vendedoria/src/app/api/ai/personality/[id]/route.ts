import { NextRequest, NextResponse } from "next/server";
import { PersonalityService } from "@/lib/services/ai-config.service";
import { PersonalityUpdateSchema, parseBody } from "@/lib/schemas/ai-config";

type Params = { params: Promise<{ id: string }> };

// GET /api/ai/personality/:id
export async function GET(_: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const profiles = await PersonalityService.list();
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 });
    return NextResponse.json(profile);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// PUT /api/ai/personality/:id — update tone, archetype, emoji, isActive
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = parseBody(PersonalityUpdateSchema, body);
    if ("error" in parsed) return NextResponse.json(parsed, { status: 422 });

    const profile = await PersonalityService.update(id, parsed.data);
    return NextResponse.json(profile);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Record to update not found"))
      return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// DELETE /api/ai/personality/:id
export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await PersonalityService.remove(id);
    return NextResponse.json({ deleted: true });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Record to delete does not exist"))
      return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
