/**
 * Simulação de passagem de bastão — envia mensagem de teste para OWNER_WHATSAPP_NUMBER
 * GET /api/debug/test-passagem?secret=<CRON_SECRET>
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";

  // Busca primeiro provider configurado e ativo
  const provider = await prisma.whatsappProviderConfig.findFirst({
    where: { status: "CONNECTED" },
    orderBy: { createdAt: "asc" },
  });

  if (!provider) {
    return NextResponse.json({ error: "Nenhum provider WhatsApp conectado encontrado" }, { status: 500 });
  }

  const token = provider.accessToken ?? undefined;
  const phoneNumberId = provider.businessPhoneNumberId;

  const handoffMsg =
    `*🔔 [SIMULAÇÃO] PEDIDO NOVO — NEXO BRASIL*\n\n` +
    `📦 *Produto:* BOMVINK 21V\n` +
    `👤 *Nome:* João da Silva\n` +
    `🏠 *Endereço:* Rua das Flores, 123, Setor Bueno\n` +
    `🗺️ *Localização:* não enviada\n` +
    `⏰ *Receber até:* 18h\n` +
    `💳 *Pagamento:* PIX\n` +
    `📱 *WhatsApp cliente:* 5562999999999\n\n` +
    `💬 *Últimas mensagens do cliente:*\n` +
    `"pode ser pix?"\n"meu endereço é Rua das Flores 123"\n"sim, pode mandar até as 18h"\n\n` +
    `_⚠️ Esta é uma mensagem de TESTE — não é um pedido real._`;

  let success = false;
  let errorMsg = "";

  try {
    await sendWhatsAppMessage(phoneNumberId, ownerNumber, handoffMsg, token);
    success = true;
  } catch (e) {
    errorMsg = String(e);
  }

  return NextResponse.json({
    success,
    to: ownerNumber,
    phoneNumberId,
    providerName: provider.accountName,
    error: errorMsg || undefined,
  });
}
