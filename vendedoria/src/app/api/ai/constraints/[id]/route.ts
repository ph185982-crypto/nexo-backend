import { NextRequest, NextResponse } from "next/server";
import { ConstraintService } from "@/lib/services/ai-config.service";
import { ConstraintUpdateSchema, parseBody } from "@/lib/schemas/ai-config";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const rule = await ConstraintService.getById(id);
    if (!rule) return NextResponse.json({ error: "Restrição não encontrada" }, { status: 404 });
    return NextResponse.json(rule);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = parseBody(ConstraintUpdateSchema, body);
    if ("error" in parsed) return NextResponse.json(parsed, { status: 422 });

    const rule = await ConstraintService.update(id, parsed.data);
    return NextResponse.json(rule);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Record to update not found"))
      return NextResponse.json({ error: "Restrição não encontrada" }, { status: 404 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await ConstraintService.remove(id);
    return NextResponse.json({ deleted: true });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Record to delete does not exist"))
      return NextResponse.json({ error: "Restrição não encontrada" }, { status: 404 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
