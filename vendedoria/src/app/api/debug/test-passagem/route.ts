/**
 * Diagnóstico completo + simulação de passagem de bastão
 * POST /api/debug/test-passagem  — autenticado por sessão NextAuth
 * GET  /api/debug/test-passagem?secret=<CRON_SECRET>  — via URL
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

const GRAPH_API_VERSION = "v20.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

async function runDiagnostic() {
  const ownerRaw  = process.env.OWNER_WHATSAPP_NUMBER ?? "";
  const ownerFull = ownerRaw.replace(/\D/g, "");
  // Garante prefixo 55 (Brasil)
  const ownerNumber = ownerFull.startsWith("55") ? ownerFull : `55${ownerFull}`;

  // ── Provider ──────────────────────────────────────────────────────────────
  const provider = await prisma.whatsappProviderConfig.findFirst({
    orderBy: { createdAt: "asc" },
  });

  const diag: Record<string, unknown> = {
    ownerNumberRaw:   ownerRaw   || "(não configurado)",
    ownerNumberSend:  ownerNumber,
    envMetaToken:     !!process.env.META_WHATSAPP_ACCESS_TOKEN,
    envMetaPhoneId:   process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? "(não configurado)",
    provider: provider ? {
      id:                   provider.id,
      name:                 provider.accountName,
      status:               provider.status,
      businessPhoneNumberId: provider.businessPhoneNumberId,
      hasDbToken:           !!provider.accessToken,
      dbTokenPrefix:        provider.accessToken ? provider.accessToken.slice(0, 12) + "…" : null,
    } : "NENHUM PROVIDER ENCONTRADO",
  };

  if (!provider) {
    return { ok: false, diag, error: "Nenhum provider WhatsApp encontrado no banco" };
  }

  if (!ownerNumber || ownerNumber.length < 10) {
    return { ok: false, diag, error: "OWNER_WHATSAPP_NUMBER não configurado ou inválido" };
  }

  // Token: DB tem prioridade, senão env var
  const token = provider.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN ?? "";
  diag.tokenSource = provider.accessToken ? "banco de dados" : process.env.META_WHATSAPP_ACCESS_TOKEN ? "env META_WHATSAPP_ACCESS_TOKEN" : "NENHUM TOKEN";

  if (!token) {
    return { ok: false, diag, error: "Nenhum access token disponível (nem no banco nem na env var META_WHATSAPP_ACCESS_TOKEN)" };
  }

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
    `_⚠️ Mensagem de TESTE — não é um pedido real._`;

  // Chama Meta API diretamente para ver o erro exato
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: ownerNumber,
    type: "text",
    text: { body: handoffMsg },
  };

  let metaStatus = 0;
  let metaResponse = "";
  try {
    const res = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    metaStatus = res.status;
    metaResponse = await res.text();
    diag.metaStatus   = metaStatus;
    diag.metaResponse = metaResponse.slice(0, 500);

    if (!res.ok) {
      return { ok: false, diag, error: `Meta API retornou HTTP ${metaStatus}: ${metaResponse.slice(0, 300)}` };
    }

    return { ok: true, diag, message: `Mensagem enviada para ${ownerNumber}` };
  } catch (e) {
    diag.networkError = String(e);
    return { ok: false, diag, error: `Erro de rede: ${String(e)}` };
  }
}

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runDiagnostic());
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runDiagnostic());
}
