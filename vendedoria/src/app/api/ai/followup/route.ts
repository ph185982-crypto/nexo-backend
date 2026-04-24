import { NextRequest, NextResponse } from "next/server";
import { FollowUpService } from "@/lib/services/ai-config.service";
import { FollowUpSettingsSchema, parseBody } from "@/lib/schemas/ai-config";

// GET /api/ai/followup — current follow-up settings
export async function GET() {
  try {
    const settings = await FollowUpService.get();
    if (!settings) return NextResponse.json({ error: "AgentConfig não encontrado" }, { status: 404 });
    return NextResponse.json(settings);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// PUT /api/ai/followup — update maxFollowUps, intervals, prompt
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = parseBody(FollowUpSettingsSchema, body);
    if ("error" in parsed) return NextResponse.json(parsed, { status: 422 });

    const settings = await FollowUpService.update(parsed.data);
    return NextResponse.json(settings);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("AgentConfig não encontrado"))
      return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
