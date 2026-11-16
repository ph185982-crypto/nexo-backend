import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { acionarFollowupsSePreciso } from "@/lib/followup/gatilho";
import { acionarRecuperacaoSePreciso } from "@/lib/ai/sdr/recuperar-falhas";
import { acionarAvisoContasSePreciso } from "@/lib/max/crons/contas-vespera";
import { despacharOutboxCrm } from "@/lib/crm-externo/outbox";
import { comercialNativo, crmConfigurado, eventosComercialAtivos } from "@/lib/crm-externo/eventos";
import { sincronizarConversasCrm } from "@/lib/crm-externo/conversas";
import { deepseekAtivo, provedorPrincipal } from "@/lib/ai/deepseek";
import { geminiAtivo } from "@/lib/ai/gemini";

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
  // Aviso de véspera das contas a pagar (o Max avisa o dono um dia antes).
  const avisoContas = dbStatus === "connected" ? acionarAvisoContasSePreciso("health") : "sem-banco";

  // Eventos para o CRM Avanteza que ficaram pendentes (CRM fora do ar, timeout…).
  // COMERCIAL_NATIVO=1: os mesmos eventos são tratados em processo (o campo segue com o mesmo formato).
  const crm = dbStatus !== "connected" ? "sem-banco" : !eventosComercialAtivos() ? "desligado" : await despacharOutboxCrm({ limite: 5, orcamentoMs: 15_000 }).catch(() => "erro" as const);
  // Conversas do WhatsApp espelhadas na ficha do CRM (o webhook já manda as recentes; aqui pega o que ficou).
  const crmConversas = dbStatus !== "connected" || !crmConfigurado() || comercialNativo() ? undefined : await sincronizarConversasCrm({ limite: 20, orcamentoMs: 12_000 }).catch(() => "erro" as const);

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
      avisoContas,
      // Qual provedor de IA responde primeiro (só o nome, nunca a chave).
      llm: provedorPrincipal(),
      max: deepseekAtivo() ? "deepseek" : process.env.OPENAI_API_KEY ? "openai" : "nenhum",
      transcricao: geminiAtivo() ? "gemini" : process.env.OPENAI_API_KEY ? "openai" : "nenhuma",
      env: process.env.NODE_ENV,
      ts: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
