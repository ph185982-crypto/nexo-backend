import { NextResponse } from "next/server";
import { processarFollowupsVencidos } from "@/lib/followup/processar";
import { drainWebhookQueue } from "@/lib/jobs/webhook-queue";

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
  return NextResponse.json({ ok: true, followups, queue });
}
