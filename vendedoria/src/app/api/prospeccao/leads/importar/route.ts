import { NextRequest, NextResponse } from "next/server";
import { importarPlanilha } from "@/lib/prospeccao/importacao";

export const maxDuration = 60;

// POST /api/prospeccao/leads/importar — multipart/form-data: file + organizationId
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const organizationId = form?.get("organizationId");

  if (!(file instanceof File) || typeof organizationId !== "string" || !organizationId) {
    return NextResponse.json(
      { error: "file e organizationId são obrigatórios (multipart/form-data)" },
      { status: 400 },
    );
  }

  try {
    const buffer = await file.arrayBuffer();
    const resultado = await importarPlanilha(buffer, organizationId);
    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
