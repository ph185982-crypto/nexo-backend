// Rotina do Comercial (cron da Vercel, a cada 10 min; vercel.json). Exige CRON_SECRET.
// A cada chamada: automações vencidas (fila de ações), eventos do Vendedor IA pendentes na outbox (CRM antigo por
// HTTP ou, com COMERCIAL_NATIVO=1, tratados aqui), reconciliação dos contratos com a ClickSign (rede de segurança
// do webhook) e reenvio dos eventos pendentes para a Central.
// Uma vez por dia (a partir das 7h de Brasília; lib/comercial/rotina-diaria.ts): rotina das entregas e varredura
// das automações de tempo — o que o /api/cron/automacoes do CRM antigo fazia.
import { NextResponse } from "next/server";
import { reconciliarContratos } from "@/lib/comercial/contratos/servico";
import { despacharEventosCentral } from "@/lib/comercial/contratos/central";
import { rodarRotinaDiariaSeHora } from "@/lib/comercial/rotina-diaria";
import { processarVencidas } from "@/lib/comercial/automacao/motor";
import { despacharOutboxCrm } from "@/lib/crm-externo/outbox";
import { eventosComercialAtivos } from "@/lib/crm-externo/eventos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const erro = (e: unknown) => ({ erro: String((e as Error)?.message ?? e).slice(0, 200) });

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const q = new URL(req.url).searchParams.get("secret");
  if (!segredo || (auth !== `Bearer ${segredo}` && q !== segredo)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rotina = await rodarRotinaDiariaSeHora().catch(erro);
  const automacoes = await processarVencidas().catch(erro);
  const eventos = eventosComercialAtivos() ? await despacharOutboxCrm({ limite: 20, orcamentoMs: 15_000 }).catch(erro) : "desligado";
  const contratos = await reconciliarContratos().catch(erro);
  const central = await despacharEventosCentral().catch(erro);
  return NextResponse.json({ ok: true, rotina, automacoes, eventos, contratos, central });
}
