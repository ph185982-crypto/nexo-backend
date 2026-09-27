import { NextRequest, NextResponse } from "next/server";
import { gerarPlanilhaModelo } from "@/lib/prospeccao/importacao";
import { exigirAcesso } from "@/lib/prospeccao/guard";

// GET /api/prospeccao/leads/modelo — planilha modelo pra importação manual de leads
export async function GET(req: NextRequest) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const buffer = gerarPlanilhaModelo();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modelo-leads-disparo.xlsx"',
    },
  });
}
