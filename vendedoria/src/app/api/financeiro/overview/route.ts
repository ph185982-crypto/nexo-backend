import { NextRequest, NextResponse } from "next/server";
import { getFinancialOverview } from "@/lib/finance/repository";

export async function GET(req: NextRequest) {
  const organizationId = new URL(req.url).searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });
  const overview = await getFinancialOverview(organizationId);
  return NextResponse.json(overview);
}
