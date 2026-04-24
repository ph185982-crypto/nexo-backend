import { NextRequest, NextResponse } from "next/server";
import { ObjectionService } from "@/lib/services/ai-config.service";
import { ObjectionCreateSchema, parseBody } from "@/lib/schemas/ai-config";

// GET /api/ai/objections?active=true
export async function GET(req: NextRequest) {
  try {
    const onlyActive = new URL(req.url).searchParams.get("active") === "true";
    return NextResponse.json(await ObjectionService.list(onlyActive));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST /api/ai/objections
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = parseBody(ObjectionCreateSchema, body);
    if ("error" in parsed) return NextResponse.json(parsed, { status: 422 });

    const rule = await ObjectionService.create(parsed.data);
    return NextResponse.json(rule, { status: 201 });
  } catch (e: unknown) {
    const isDuplicate = e instanceof Error && e.message.includes("Unique constraint");
    if (isDuplicate) return NextResponse.json({ error: "Já existe uma regra com essa keyword" }, { status: 409 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
