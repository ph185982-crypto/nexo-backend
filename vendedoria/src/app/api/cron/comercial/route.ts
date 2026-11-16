// Rotina do Comercial (cron da Vercel, a cada 10 min; vercel.json). Exige CRON_SECRET.
// Hoje: reconciliação dos contratos com a ClickSign (rede de segurança do webhook: envelopes enviados há mais de
// 10 min ainda em aberto, assinados sem PDF ou sem automação) e reenvio dos eventos pendentes para a Central.
import { NextResponse } from "next/server";
import { reconciliarContratos } from "@/lib/comercial/contratos/servico";
import { despacharEventosCentral } from "@/lib/comercial/contratos/central";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const q = new URL(req.url).searchParams.get("secret");
  if (!segredo || (auth !== `Bearer ${segredo}` && q !== segredo)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const contratos = await reconciliarContratos().catch((e) => ({ erro: String((e as Error).message) }));
  const central = await despacharEventosCentral().catch((e) => ({ erro: String((e as Error).message) }));
  return NextResponse.json({ ok: true, contratos, central });
}
