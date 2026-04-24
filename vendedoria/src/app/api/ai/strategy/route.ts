import { NextRequest, NextResponse } from "next/server";
import { StrategyService } from "@/lib/services/ai-config.service";
import { StrategyCreateSchema, parseBody } from "@/lib/schemas/ai-config";

// GET /api/ai/strategy
export async function GET() {
  try {
    return NextResponse.json(await StrategyService.list());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST /api/ai/strategy
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = parseBody(StrategyCreateSchema, body);
    if ("error" in parsed) return NextResponse.json(parsed, { status: 422 });

    const strategy = await StrategyService.create(parsed.data);
    return NextResponse.json(strategy, { status: 201 });
  } catch (e: unknown) {
    const isDuplicate = e instanceof Error && e.message.includes("Unique constraint");
    if (isDuplicate) return NextResponse.json({ error: "Já existe uma estratégia com esse nome" }, { status: 409 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
