/**
 * Simulação de passagem de bastão — envia mensagem de teste para OWNER_WHATSAPP_NUMBER
 * GET /api/debug/test-passagem?secret=<CRON_SECRET>
 * POST /api/debug/test-passagem   (autenticado por sessão NextAuth)
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { auth } from "@/lib/auth";

async function runSimulation() {
  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";

  const provider = await prisma.whatsappProviderConfig.findFirst({
    where: { status: "CONNECTED" },
    orderBy: { createdAt: "asc" },
  });

  if (!provider) {
    return { ok: false, error: "Nenhum provider WhatsApp conectado encontrado" };
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

  try {
    await sendWhatsAppMessage(phoneNumberId, ownerNumber, handoffMsg, token);
    return { ok: true, to: ownerNumber, phoneNumberId, providerName: provider.accountName };
  } catch (e) {
    return { ok: false, error: String(e), to: ownerNumber, phoneNumberId, providerName: provider.accountName };
  }
}

// Via URL com CRON_SECRET
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runSimulation());
}

// Via sessão autenticada (chamado pelo botão da UI)
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runSimulation());
}
