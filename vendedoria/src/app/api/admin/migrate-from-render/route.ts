/**
 * One-time migration: copy all data from old Render DB → current DB (Neon).
 * GET /api/admin/migrate-from-render?secret=<CRON_SECRET>&sourceUrl=<URL>
 *
 * The sourceUrl should be the old Render external connection string (URL-encoded).
 * Runs table-by-table, upserts records, skips duplicates.
 */
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const maxDuration = 300;

function makeSource(url: string) {
  return new PrismaClient({ datasources: { db: { url } } });
}

async function migrateTable<T extends Record<string, unknown>>(
  src: PrismaClient,
  dst: PrismaClient,
  model: string,
  idField = "id"
): Promise<{ model: string; copied: number; errors: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const srcModel = (src as any)[model];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dstModel = (dst as any)[model];
  if (!srcModel || !dstModel) return { model, copied: 0, errors: -1 };

  let copied = 0;
  let errors = 0;
  const rows: T[] = await srcModel.findMany();

  for (const row of rows) {
    try {
      await dstModel.upsert({
        where: { [idField]: row[idField] },
        create: row,
        update: row,
      });
      copied++;
    } catch {
      errors++;
    }
  }
  return { model, copied, errors };
}

// Migration order respects FK constraints
const MIGRATION_ORDER = [
  "user",
  "account",
  "session",
  "verificationToken",
  "whatsappBusinessOrganization",
  "whatsappProviderConfig",
  "agent",
  "agentConfig",
  "agentScriptVersion",
  "agentPromptHistory",
  "aiConfig",
  "kanbanColumn",
  "tag",
  "lead",
  "leadActivity",
  "leadNote",
  "leadTag",
  "leadEscalation",
  "product",
  "produto",
  "campaign",
  "campaignRecipient",
  "ofertaGerada",
  "whatsappConversation",
  "whatsappMessage",
  "ownerNotification",
  "conversationFollowUp",
  "conversationTag",
  "webhookQueue",
  "pushSubscription",
  "orgHierarchyItem",
  "calendarEvent",
  "calendarAttendee",
  "calendarReminder",
  "profissionalEntity",
  "profissionalWorkProfile",
  "profissionalAvailability",
  "workUnitEntity",
];

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sourceUrl = url.searchParams.get("sourceUrl");
  if (!sourceUrl) {
    return NextResponse.json({ error: "sourceUrl parameter required" }, { status: 400 });
  }

  const decodedUrl = decodeURIComponent(sourceUrl);
  const src = makeSource(decodedUrl);
  const dst = new PrismaClient();

  const results: Array<{ model: string; copied: number; errors: number }> = [];

  try {
    await src.$connect();
    await dst.$connect();

    for (const model of MIGRATION_ORDER) {
      const result = await migrateTable(src, dst, model);
      results.push(result);
      console.log(`[migrate] ${model}: ${result.copied} copied, ${result.errors} errors`);
    }
  } finally {
    await src.$disconnect();
    await dst.$disconnect();
  }

  const totalCopied = results.reduce((s, r) => s + r.copied, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors, 0);

  return NextResponse.json({
    ok: true,
    totalCopied,
    totalErrors,
    results,
  });
}
