import { NextRequest, NextResponse } from "next/server";
import { importarDoFornecedor, importarManual } from "@/lib/produtos/importador";

export async function POST(req: NextRequest) {
  try {
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
    console.error("[importar] erro:", err);
    return NextResponse.json(
      { error: "Falha na importação", detail: String(err) },
      { status: 500 }
    );
  }
}
