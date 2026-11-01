import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { acionarFollowupsSePreciso } from "@/lib/followup/gatilho";
import { acionarRecuperacaoSePreciso } from "@/lib/ai/sdr/recuperar-falhas";

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

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
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
