import { NextResponse } from "next/server";
import { processarFollowupsVencidos } from "@/lib/followup/processar";
import { drainWebhookQueue } from "@/lib/jobs/webhook-queue";
import { avisarContasDeAmanha } from "@/lib/max/crons/contas-vespera";

// Entrada por HTTP do processador de follow-ups (GitHub Actions / cron externo).
// A lógica mora em lib/followup/processar.ts e também é acionada sem segredo
// pelo webhook, pelo /api/health e pelas telas do CRM (lib/followup/gatilho.ts).
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.CRON_SECRET || (auth !== `Bearer ${process.env.CRON_SECRET}` && secret !== process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const followups = await processarFollowupsVencidos({ orcamentoMs: 50_000 });
  // Lógica compartilhada com o dreno oportunista do webhook (claim atômico,
  // seguro rodar em paralelo com ele).
  const queue = await drainWebhookQueue(20);
  // Aviso de véspera das contas a pagar (dedup no banco; fora das 8h–21h não faz nada).
  const contas = await avisarContasDeAmanha().catch((e) => ({ situacao: "erro" as const, contas: 0, erro: String(e) }));
  return NextResponse.json({ ok: true, followups, queue, contas });
}
