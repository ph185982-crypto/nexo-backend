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

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Em serverless a função pode ser congelada assim que a resposta é enviada —
  // um "fire-and-forget" sem await arrisca nunca terminar. Aguarda com timeout.
  await Promise.race([
    retomarDisparosPendentes(),
    new Promise((resolve) => setTimeout(resolve, 20_000)),
  ]).catch((e) => console.error("[Healthcheck] retomarDisparosPendentes falhou:", e));

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

  // 4. Agente ativo em sandboxMode — a IA para de responder clientes reais em
  // silêncio total quando isso acontece por engano (ver /crm/settings).
  const agentesSandbox = await prisma.agent.findMany({
    where: { status: "ACTIVE", sandboxMode: true },
    select: { id: true, displayName: true },
  });
  for (const a of agentesSandbox) {
    const enviado = await alertarDono(
      `health-sandbox-${a.id}-${hoje}`,
      `🚨 Alerta NEXO: o agente "${a.displayName}" está em modo SANDBOX — ele NÃO está respondendo clientes reais no WhatsApp. Se isso não foi proposital, desligue em Configurações do Agente agora.`,
    );
    if (enviado) alertas.push(`sandbox:${a.id}`);
  }

  // 5. Mensagens da IA marcadas como falha de envio nas últimas 24h (token
  // expirado, janela de 24h fechada, número inválido, etc.)
  const mensagensFalhas = await prisma.whatsappMessage.count({
    where: { role: "ASSISTANT", status: "FAILED", sentAt: { gte: ontem } },
  });
  if (mensagensFalhas >= 3) {
    const enviado = await alertarDono(
      `health-msg-falhas-${hoje}`,
      `⚠️ Alerta NEXO: ${mensagensFalhas} respostas da IA falharam ao enviar pro WhatsApp nas últimas 24h. Confira o token/conexão do número.`,
    );
    if (enviado) alertas.push(`msg_falhas:${mensagensFalhas}`);
  }

  return NextResponse.json({
    ok: true,
    verificadoEm: new Date().toISOString(),
    disparosPausados: pausados.length,
    providersComProblema: providersRuins.length,
    errosEnvio24h: errosEnvio,
    agentesSandbox: agentesSandbox.length,
    mensagensFalhas24h: mensagensFalhas,
    alertasEnviados: alertas,
  });
}
