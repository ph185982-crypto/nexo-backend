import { NextRequest, NextResponse } from "next/server";
import { ConstraintService } from "@/lib/services/ai-config.service";
import { ConstraintCreateSchema, parseBody } from "@/lib/schemas/ai-config";

// GET /api/ai/constraints?active=true
export async function GET(req: NextRequest) {
  try {
    const onlyActive = new URL(req.url).searchParams.get("active") === "true";
    return NextResponse.json(await ConstraintService.list(onlyActive));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST /api/ai/constraints
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = parseBody(ConstraintCreateSchema, body);
    if ("error" in parsed) return NextResponse.json(parsed, { status: 422 });

    const rule = await ConstraintService.create(parsed.data);
    return NextResponse.json(rule, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
