import { NextRequest, NextResponse } from "next/server";
import { StrategyService } from "@/lib/services/ai-config.service";
import { StrategyUpdateSchema, parseBody } from "@/lib/schemas/ai-config";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const all = await StrategyService.list();
    const s = all.find((x) => x.id === id);
    if (!s) return NextResponse.json({ error: "Estratégia não encontrada" }, { status: 404 });
    return NextResponse.json(s);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = parseBody(StrategyUpdateSchema, body);
    if ("error" in parsed) return NextResponse.json(parsed, { status: 422 });

    const strategy = await StrategyService.update(id, parsed.data);
    return NextResponse.json(strategy);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Record to update not found"))
      return NextResponse.json({ error: "Estratégia não encontrada" }, { status: 404 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await StrategyService.remove(id);
    return NextResponse.json({ deleted: true });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Record to delete does not exist"))
      return NextResponse.json({ error: "Estratégia não encontrada" }, { status: 404 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
