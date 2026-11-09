import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { acionarFollowupsSePreciso } from "@/lib/followup/gatilho";
import { acionarRecuperacaoSePreciso } from "@/lib/ai/sdr/recuperar-falhas";
import { despacharOutboxCrm } from "@/lib/crm-externo/outbox";
import { crmConfigurado } from "@/lib/crm-externo/eventos";
import { sincronizarConversasCrm } from "@/lib/crm-externo/conversas";

// A rotina externa de monitoramento chama este endpoint de hora em hora — e
// agora cada chamada também dispara, em segundo plano, os follow-ups vencidos.
export const maxDuration = 60;

export async function GET() {
  let dbStatus = "connected";
  let dbError = "";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = "error";
    dbError = String(err).slice(0, 200);
  }

  const authOk = !!(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET);
  const ok = dbStatus === "connected" && authOk;
  const followups = dbStatus === "connected" ? await acionarFollowupsSePreciso("health").catch(() => "erro" as const) : "sem-banco";
  // Conversas em que a IA falhou e o cliente ficou só com a mensagem de espera.
  const recuperacao = dbStatus === "connected" ? acionarRecuperacaoSePreciso("health") : "sem-banco";

  // Eventos para o CRM Avanteza que ficaram pendentes (CRM fora do ar, timeout…).
  const crm = dbStatus !== "connected" ? "sem-banco" : !crmConfigurado() ? "desligado" : await despacharOutboxCrm({ limite: 5, orcamentoMs: 15_000 }).catch(() => "erro" as const);
  // Conversas do WhatsApp espelhadas na ficha do CRM (o webhook já manda as recentes; aqui pega o que ficou).
  const crmConversas = dbStatus !== "connected" || !crmConfigurado() ? undefined : await sincronizarConversasCrm({ limite: 20, orcamentoMs: 12_000 }).catch(() => "erro" as const);

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      crm,
      ...(crmConversas ? { crmConversas } : {}),
      db: dbStatus,
      ...(dbError ? { dbError } : {}),
      auth: authOk ? "configured" : "MISSING — NEXTAUTH_SECRET/AUTH_SECRET nao definido",
      followups,
      recuperacao,
      env: process.env.NODE_ENV,
      ts: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
