import { NextResponse } from "next/server";

// Cron semanal (segunda, 02h) — importação de produtos via planilha/API externa.
// Protegido por CRON_SECRET para evitar acionamento público.
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO: implementar importação real de produtos
  return NextResponse.json({ ok: true, message: "Importação de produtos: nenhuma fonte configurada ainda." });
}
