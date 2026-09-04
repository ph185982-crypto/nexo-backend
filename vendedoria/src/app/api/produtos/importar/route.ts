import { NextRequest, NextResponse } from "next/server";
import { importarDoFornecedor, importarManual } from "@/lib/produtos/importador";
import { requireAdmin } from "@/lib/auth/require-admin";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({})) as {
      modo?: "scraper" | "manual";
      url?: string;
      items?: Array<{ nome: string; preco: number; fotoUrl?: string; categoria?: string; descricao?: string }>;
    };

    const modo = body.modo ?? "scraper";

    if (modo === "manual") {
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return NextResponse.json(
          { error: "items[] é obrigatório no modo manual" },
          { status: 400 }
        );
      }
      const result = await importarManual(body.items);
      return NextResponse.json({ ok: true, ...result });
    }

    // modo === "scraper"
    const result = await importarDoFornecedor(body.url);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[importar] erro:", err);
    return NextResponse.json(
      { error: "Falha na importação", detail: String(err) },
      { status: 500 }
    );
  }
}
