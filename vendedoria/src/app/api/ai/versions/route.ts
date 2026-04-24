import { NextRequest, NextResponse } from "next/server";
import { VersionService } from "@/lib/services/ai-config.service";

// GET /api/ai/versions?take=20 — list config version history
export async function GET(req: NextRequest) {
  try {
    const take = Math.min(Number(new URL(req.url).searchParams.get("take") ?? "20"), 100);
    const versions = await VersionService.list(isNaN(take) ? 20 : take);
    return NextResponse.json(versions);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
