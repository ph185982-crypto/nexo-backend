// GET /api/cron/healthcheck — verificação de saúde a cada 5min (Bearer CRON_SECRET)
// O script cron-healthcheck.sh usa o próprio status HTTP para self-healing (pm2 restart em falha).
// Aqui dentro checamos condições de negócio e alertamos o dono via WhatsApp com dedup diário:
//   - disparo pausado (pausadoManualmente) — qualidade do número caiu
//   - provider com status ERROR/BANNED
//   - acúmulo de leads ERRO_ENVIO nas últimas 24h (possível token expirado)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { MAX_OWNER_NUMBER, getOwnerProvider, resolveToken } from "@/lib/max/config";
import { retomarDisparosPendentes } from "@/lib/prospeccao/disparo";

async function alertarDono(chave: string, texto: string): Promise<boolean> {
  // Dedup: 1 alerta por chave por dia via AlertaEnviadoMax (unique em chave)
  try {
    await prisma.alertaEnviadoMax.create({ data: { chave } });
  } catch {
    return false; // já enviado hoje
  }
  const provider = await getOwnerProvider();
  if (!provider) return false;
  await sendWhatsAppMessage(
    provider.businessPhoneNumberId,
    MAX_OWNER_NUMBER,
    texto,
    resolveToken(provider.accessToken),
  ).catch((e) => console.error("[Healthcheck] alerta falhou:", e));
  return true;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Retomada da fila de disparo (fire-and-forget — jobs órfãos de restart/janela)
  void retomarDisparosPendentes();

  const hoje = new Date().toISOString().slice(0, 10);
  const alertas: string[] = [];

  // 1. Disparo pausado por qualidade
  const pausados = await prisma.disparoConfig.findMany({
    where: { pausadoManualmente: true },
    select: { organizationId: true, motivoPausa: true },
  });
  for (const p of pausados) {
    const enviado = await alertarDono(
      `health-pausa-${p.organizationId}-${hoje}`,
      `🚨 Alerta NEXO: os disparos estão PAUSADOS (${p.motivoPausa ?? "sem motivo registrado"}). Verifique a tela de Disparo para retomar.`,
    );
    if (enviado) alertas.push(`pausa:${p.organizationId}`);
  }

  // 2. Provider com problema
  const providersRuins = await prisma.whatsappProviderConfig.findMany({
    where: { status: { in: ["ERROR", "BANNED"] } },
    select: { id: true, businessPhoneNumberId: true, status: true },
  });
  for (const pr of providersRuins) {
    const enviado = await alertarDono(
      `health-provider-${pr.id}-${hoje}`,
      `🚨 Alerta NEXO: o número WhatsApp ${pr.businessPhoneNumberId} está com status ${pr.status}. Verifique o Meta Business Manager.`,
    );
    if (enviado) alertas.push(`provider:${pr.id}`);
  }

  // 3. Falhas de envio acumuladas (últimas 24h)
  const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const errosEnvio = await prisma.prospectLead.count({
    where: { status: "ERRO_ENVIO", updatedAt: { gte: ontem } },
  });
  if (errosEnvio >= 5) {
    const enviado = await alertarDono(
      `health-erros-envio-${hoje}`,
      `⚠️ Alerta NEXO: ${errosEnvio} envios de prospecção falharam nas últimas 24h. Possível token expirado ou template rejeitado — confira a tela de Disparo.`,
    );
    if (enviado) alertas.push(`erros_envio:${errosEnvio}`);
  }

  return NextResponse.json({
    ok: true,
    verificadoEm: new Date().toISOString(),
    disparosPausados: pausados.length,
    providersComProblema: providersRuins.length,
    errosEnvio24h: errosEnvio,
    alertasEnviados: alertas,
  });
}
