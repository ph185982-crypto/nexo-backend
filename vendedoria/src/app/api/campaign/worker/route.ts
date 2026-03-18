import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

const CRON_SECRET = process.env.CRON_SECRET;

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

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = { processed: 0, sent: 0, failed: 0, skipped: 0 };

  // Find all active campaigns
  const activeCampaigns = await prisma.campaign.findMany({
    where: { status: "ACTIVE" },
    include: {
      sender: true,
      recipients: {
        where: { status: "PENDING" },
        take: 100, // process at most 100 per tick
      },
    },
  });

  for (const campaign of activeCampaigns) {
    // Check daily time window
    if (!isWithinDailyWindow(campaign.dailyStartTime, campaign.dailyEndTime)) {
      results.skipped += campaign.recipients.length;
      continue;
    }

    const accessToken = campaign.sender.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = campaign.sender.businessPhoneNumberId;

    // Rate limiting: maxMessagesPerMinute
    const intervalMs = Math.ceil((60 * 1000) / campaign.maxMessagesPerMinute);

    for (const recipient of campaign.recipients) {
      results.processed++;

      // Skip if lead already has an active conversation and skipExistingConversation is set
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

      // Build message from template
      const metadata = (recipient.metadata ?? {}) as Record<string, string>;
      if (recipient.name) metadata.nome = recipient.name;
      const message = buildMessage(campaign.templateMessage, metadata);

      // Random delay between minDelaySeconds and maxDelaySeconds
      const delayMs =
        (campaign.minDelaySeconds +
          Math.random() * (campaign.maxDelaySeconds - campaign.minDelaySeconds)) *
        1000;

      // Idempotency: optimistically claim the recipient before sending.
      // If the worker runs twice concurrently, only one wins the update from PENDING → SENT.
      // The second will see SENT/FAILED and won't double-send.
      const sentAt = new Date();
      const claimed = await prisma.campaignRecipient.updateMany({
        where: { id: recipient.id, status: "PENDING" },
        data: { status: "SENT", sentAt },
      });

      if (claimed.count === 0) {
        // Another worker already claimed this recipient — skip it
        results.skipped++;
        continue;
      }

      try {
        await sendWhatsAppMessage(
          phoneNumberId,
          recipient.phoneNumber,
          message,
          accessToken ?? undefined
        );
        // Status is already SENT from the claim above
        results.sent++;
      } catch (err) {
        console.error(`[CampaignWorker] Failed to send to ${recipient.phoneNumber}:`, err);
        // Revert claim to FAILED so the UI shows the real outcome
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "FAILED", sentAt: null },
        });
        results.failed++;
      }

      // Respect rate limit and random delay
      const waitMs = Math.max(intervalMs, delayMs);
      await sleep(waitMs);
    }

    // Check if campaign is now complete
    const remaining = await prisma.campaignRecipient.count({
      where: { campaignId: campaign.id, status: "PENDING" },
    });
    if (remaining === 0) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "COMPLETED" },
      });
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
