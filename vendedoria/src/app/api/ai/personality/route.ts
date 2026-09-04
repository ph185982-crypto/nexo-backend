import { NextRequest, NextResponse } from "next/server";
import { PersonalityService } from "@/lib/services/ai-config.service";
import { PersonalityCreateSchema, parseBody } from "@/lib/schemas/ai-config";
import { requireAdmin } from "@/lib/auth/require-admin";

// GET /api/ai/personality — list all personality profiles
export async function GET() {
  try {
    await requireAdmin();
    const profiles = await PersonalityService.list();
    return NextResponse.json(profiles);
  } catch (e) {
    if (e instanceof Error && e.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST /api/ai/personality — create a new personality profile
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const parsed = parseBody(PersonalityCreateSchema, body);
    if ("error" in parsed) return NextResponse.json(parsed, { status: 422 });

    const profile = await PersonalityService.create(parsed.data);
    return NextResponse.json(profile, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const isDuplicate = e instanceof Error && e.message.includes("Unique constraint");
    if (isDuplicate) return NextResponse.json({ error: "Já existe um perfil com esse nome" }, { status: 409 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
