import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { criarOrcamento, enfileirar } from "@/lib/jobs/fila";

// Teto da função — o que não couber é retomado numa nova invocação encadeada.
export const maxDuration = 60;

/**
 * Aceita as três formas de chamada: cron da Vercel (Authorization: Bearer),
 * cron externo (?secret=) e o encadeamento interno (x-cron-secret via enfileirar()).
 */
function autorizado(req: NextRequest): boolean {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) return false;

  const auth = req.headers.get("authorization");
  const header = req.headers.get("x-cron-secret");
  const query = new URL(req.url).searchParams.get("secret");

  return auth === `Bearer ${esperado}` || header === esperado || query === esperado;
}

function isWithinDailyWindow(startTime: string, endTime: string): boolean {
  const now = new Date();
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

function buildMessage(template: string, metadata: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => metadata[key] ?? `{{${key}}}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executar(req: NextRequest): Promise<NextResponse> {
  if (!autorizado(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orcamento = criarOrcamento(60, 10);
  const results = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  let restante = false;

  const activeCampaigns = await prisma.campaign.findMany({
    where: { status: "ACTIVE" },
    include: {
      sender: true,
      recipients: {
        where: { status: "PENDING" },
        take: 100, // processa no máximo 100 por invocação
      },
    },
  });

  outer: for (const campaign of activeCampaigns) {
    if (!isWithinDailyWindow(campaign.dailyStartTime, campaign.dailyEndTime)) {
      results.skipped += campaign.recipients.length;
      continue;
    }

    const accessToken = campaign.sender.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = campaign.sender.businessPhoneNumberId;
    const intervalMs = Math.ceil((60 * 1000) / campaign.maxMessagesPerMinute);

    for (const recipient of campaign.recipients) {
      if (orcamento.estourou()) {
        restante = true;
        break outer;
      }

      results.processed++;

      if (campaign.skipExistingConversation) {
        const existing = await prisma.whatsappConversation.findFirst({
          where: {
            customerWhatsappBusinessId: recipient.phoneNumber,
            whatsappProviderConfigId: campaign.senderId,
            isActive: true,
          },
        });
        if (existing) {
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: "SKIPPED" },
          });
          results.skipped++;
          continue;
        }
      }

      const metadata = (recipient.metadata ?? {}) as Record<string, string>;
      if (recipient.name) metadata.nome = recipient.name;
      const message = buildMessage(campaign.templateMessage, metadata);

      const delayMs =
        (campaign.minDelaySeconds +
          Math.random() * (campaign.maxDelaySeconds - campaign.minDelaySeconds)) *
        1000;

      // Idempotência: reivindica o destinatário antes de enviar. Se o worker
      // rodar duas vezes em paralelo, só uma delas ganha a troca PENDING → SENT.
      const sentAt = new Date();
      const claimed = await prisma.campaignRecipient.updateMany({
        where: { id: recipient.id, status: "PENDING" },
        data: { status: "SENT", sentAt },
      });

      if (claimed.count === 0) {
        results.skipped++;
        continue;
      }

      try {
        await sendWhatsAppMessage(phoneNumberId, recipient.phoneNumber, message, accessToken ?? undefined);
        results.sent++;
      } catch (err) {
        console.error(`[CampaignWorker] Failed to send to ${recipient.phoneNumber}:`, err);
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "FAILED", sentAt: null },
        });
        results.failed++;
      }

      const waitMs = Math.max(intervalMs, delayMs);
      if (orcamento.restanteMs() > waitMs) await sleep(waitMs);
    }

    const remaining = await prisma.campaignRecipient.count({
      where: { campaignId: campaign.id, status: "PENDING" },
    });
    if (remaining === 0) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "COMPLETED" } });
    } else if (remaining > 0) {
      restante = true;
    }
  }

  if (restante) {
    await enfileirar("/api/campaign/worker", { delaySegundos: 5 }).catch((e) =>
      console.error("[CampaignWorker] Falha ao encadear continuação:", e),
    );
  }

  return NextResponse.json({ ok: true, ...results, continuacaoAgendada: restante });
}

export async function GET(req: NextRequest) {
  return executar(req);
}

export async function POST(req: NextRequest) {
  return executar(req);
}
