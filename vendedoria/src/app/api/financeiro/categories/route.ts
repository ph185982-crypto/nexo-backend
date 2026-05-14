import { NextRequest, NextResponse } from "next/server";
import { listCategories, createCategory, seedDefaultCategories } from "@/lib/finance/repository";

export async function GET(req: NextRequest) {
  const organizationId = new URL(req.url).searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });
  await seedDefaultCategories(organizationId);
  const categories = await listCategories(organizationId);
  return NextResponse.json(categories);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    organizationId?: string;
    name?: string;
    type?: string;
    icon?: string;
    color?: string;
  };
  if (!body.organizationId || !body.name || !body.type) {
    return NextResponse.json({ error: "organizationId, name, type required" }, { status: 400 });
  }
  if (!["RECEITA", "DESPESA"].includes(body.type)) {
    return NextResponse.json({ error: "type must be RECEITA or DESPESA" }, { status: 400 });
  }
  const category = await createCategory(body.organizationId, {
    name: body.name,
    type: body.type as "RECEITA" | "DESPESA",
    icon: body.icon,
    color: body.color,
  });
  return NextResponse.json(category, { status: 201 });
}
