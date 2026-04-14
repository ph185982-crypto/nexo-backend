import { NextRequest, NextResponse } from "next/server";
import { importarDoFornecedor } from "@/lib/produtos/importador";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { prisma } from "@/lib/prisma/client";

/**
 * POST /api/cron/importar-produtos
 *
 * Runs every Sunday at 23:00 Brasília time (Mon 02:00 UTC).
 * Scrapes the supplier site, upserts products in DB,
 * then sends a WhatsApp summary to the owner.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[cron/importar-produtos] Iniciando importação semanal...");

  try {
    const resultado = await importarDoFornecedor();

    // Send WhatsApp notification to owner
    const provider = await prisma.whatsappProviderConfig.findFirst({
      orderBy: { createdAt: "asc" },
    });
    const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER ??
      (await prisma.agentConfig.findFirst().then((c) => c?.bastaoNumber)) ??
      "5562984465388";

    if (provider) {
      const msg = resultado.total === 0
        ? `⚠️ *Importação semanal*: nenhum produto encontrado no fornecedor. Verifique a URL do catálogo.`
        : `✅ *Importação semanal concluída!*\n\n` +
          `📦 Total: ${resultado.total} ferramentas\n` +
          `🆕 Novos: ${resultado.novos}\n` +
          `🔄 Atualizados: ${resultado.atualizados}\n` +
          `⏭️ Ignorados: ${resultado.ignorados}\n\n` +
          `_Importado automaticamente — ${new Date().toLocaleDateString("pt-BR")}_`;

      await sendWhatsAppMessage(
        provider.businessPhoneNumberId,
        ownerNumber,
        msg,
        provider.accessToken ?? undefined
      ).catch((err) => console.error("[cron/importar-produtos] Falha ao notificar:", err));
    }

    return NextResponse.json({ ok: true, ...resultado });
  } catch (err) {
    console.error("[cron/importar-produtos] erro:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
