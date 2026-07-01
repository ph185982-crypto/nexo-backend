import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

const GRAPH_API_VERSION = "v20.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

interface QualityRatingResponse {
  quality_rating?: string;
  display_phone_number?: string;
}

async function consultarQualidadeNumero(
  phoneNumberId: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/${phoneNumberId}?fields=quality_rating,display_phone_number`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const data = await res.json() as QualityRatingResponse;
    return data.quality_rating ?? null;
  } catch {
    return null;
  }
}

async function notificarPedroBloqueio(mensagem: string): Promise<void> {
  const pedroPhone = process.env.MANAGER_PHONE_NUMBER;
  if (!pedroPhone) return;

  // Usa a org de vendas (não a de prospecção) para garantir que a notificação chegue
  const providerVendas = await prisma.whatsappProviderConfig.findFirst({
    where: { organization: { tipo: "VENDAS" }, status: "CONNECTED" },
  });
  if (!providerVendas) return;

  const token = providerVendas.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN;
  if (!token) return;

  await sendWhatsAppMessage(
    providerVendas.businessPhoneNumberId,
    pedroPhone,
    `⚠️ *Alerta Prospecção:* ${mensagem}`,
    token,
  ).catch(() => {});
}

/**
 * Consulta a qualidade do número de prospecção da org.
 * Se RED ou YELLOW, pausa o disparo automaticamente e notifica Pedro.
 * Retorna true se o número está saudável (pode disparar).
 */
export async function verificarSaudeNumero(organizationId: string): Promise<boolean> {
  const providerConfig = await prisma.whatsappProviderConfig.findFirst({
    where: { organizationId },
  });

  if (!providerConfig) return false;

  const token = providerConfig.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    console.warn("[SaudeNumero] Sem access token para org", organizationId);
    return false;
  }

  // Verifica status do provider no banco
  if (providerConfig.status === "ERROR" || providerConfig.status === "BANNED") {
    const motivo = `Número ${providerConfig.displayPhoneNumber} com status ${providerConfig.status} — disparo pausado automaticamente`;
    await prisma.disparoConfig.upsert({
      where: { organizationId },
      update: { pausadoManualmente: true, motivoPausa: motivo },
      create: {
        organizationId,
        pausadoManualmente: true,
        motivoPausa: motivo,
      },
    });
    await notificarPedroBloqueio(motivo);
    return false;
  }

  const qualidade = await consultarQualidadeNumero(
    providerConfig.businessPhoneNumberId,
    token,
  );

  if (qualidade === "RED" || qualidade === "YELLOW") {
    const motivo = `Qualidade do número ${providerConfig.displayPhoneNumber} caiu para ${qualidade} — disparo pausado automaticamente`;
    await prisma.disparoConfig.upsert({
      where: { organizationId },
      update: { pausadoManualmente: true, motivoPausa: motivo },
      create: {
        organizationId,
        pausadoManualmente: true,
        motivoPausa: motivo,
      },
    });
    console.warn("[SaudeNumero]", motivo);
    await notificarPedroBloqueio(motivo);
    return false;
  }

  return true;
}
