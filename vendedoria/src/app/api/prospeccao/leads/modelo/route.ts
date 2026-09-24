import { NextResponse } from "next/server";
import { gerarPlanilhaModelo } from "@/lib/prospeccao/importacao";

// GET /api/prospeccao/leads/modelo — planilha modelo pra importação manual de leads
export async function GET() {
  const buffer = gerarPlanilhaModelo();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modelo-leads-disparo.xlsx"',
    },
  });
}
