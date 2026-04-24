import { NextRequest, NextResponse } from "next/server";
import { PersonalityService } from "@/lib/services/ai-config.service";
import { PersonalityCreateSchema, parseBody } from "@/lib/schemas/ai-config";

// GET /api/ai/personality — list all personality profiles
export async function GET() {
  try {
    const profiles = await PersonalityService.list();
    return NextResponse.json(profiles);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST /api/ai/personality — create a new personality profile
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = parseBody(PersonalityCreateSchema, body);
    if ("error" in parsed) return NextResponse.json(parsed, { status: 422 });

    const profile = await PersonalityService.create(parsed.data);
    return NextResponse.json(profile, { status: 201 });
  } catch (e: unknown) {
    const isDuplicate = e instanceof Error && e.message.includes("Unique constraint");
    if (isDuplicate) return NextResponse.json({ error: "Já existe um perfil com esse nome" }, { status: 409 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
