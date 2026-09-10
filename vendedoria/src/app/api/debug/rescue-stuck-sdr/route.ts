import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";
import { processSdrResponse } from "@/lib/ai/sdr/agent";

// Cada conversa recuperada passa pelo ciclo normal do SDR (LLM + "digitando" +
// envio de balões), 12-20s cada — processar todas as travadas de uma vez
// pode passar do limite da função. maxDuration=60 (teto do plano) + um
// orçamento de tempo no loop: processa o quanto couber e devolve o resto
// pendente pra rodar de novo.
export const maxDuration = 60;

/**
 * TEMPORARY — one-off recovery for conversations where the SDR silently
 * failed to reply because the OpenAI account had no credit (2026-08-31 to
 * 2026-09-10, error "insufficient_quota"). Finds SDR conversations whose
 * newest message is still role=USER (customer waiting, no AI reply ever
 * sent) and replays processSdrResponse for each, now that credit exists.
 * DELETE THIS FILE after the recovery run.
 */
async function findStuckConversations() {
  const org = await prisma.whatsappBusinessOrganization.findFirst({
    where: { tipo: "PROSPECCAO" },
    select: { id: true },
  });
  if (!org) return [];

  const providers = await prisma.whatsappProviderConfig.findMany({
    where: { organizationId: org.id },
    select: { id: true, agent: { select: { id: true, aiProvider: true, aiModel: true, sandboxMode: true, kind: true, status: true } } },
  });

  const stuck: Array<{
    conversationId: string;
    lead: string;
    lastMessageId: string;
    lastMessageContent: string;
    sentAt: Date;
    agent: { id: string; aiProvider: string | null; aiModel: string | null; sandboxMode: boolean };
  }> = [];

  for (const provider of providers) {
    if (!provider.agent || provider.agent.kind !== "AI" || provider.agent.status !== "ACTIVE") continue;

    const conversations = await prisma.whatsappConversation.findMany({
      where: {
        whatsappProviderConfigId: provider.id,
        humanTakeover: false,
        lastMessageAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
        lead: { status: { notIn: ["ESCALATED", "BLOCKED", "CLOSED"] } },
      },
      select: {
        id: true,
        profileName: true,
        customerWhatsappBusinessId: true,
        messages: { orderBy: { sentAt: "desc" }, take: 1, select: { id: true, role: true, content: true, sentAt: true } },
      },
    });

    for (const conv of conversations) {
      const last = conv.messages[0];
      if (!last || last.role !== "USER") continue; // já foi respondida
      stuck.push({
        conversationId: conv.id,
        lead: conv.profileName ?? conv.customerWhatsappBusinessId,
        lastMessageId: last.id,
        lastMessageContent: last.content,
        sentAt: last.sentAt,
        agent: {
          id: provider.agent.id,
          aiProvider: provider.agent.aiProvider,
          aiModel: provider.agent.aiModel,
          sandboxMode: provider.agent.sandboxMode,
        },
      });
    }
  }

  return stuck;
}

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const stuck = await findStuckConversations();
  return NextResponse.json({
    count: stuck.length,
    stuck: stuck.map((s) => ({ conversationId: s.conversationId, lead: s.lead, lastMessageContent: s.lastMessageContent, sentAt: s.sentAt })),
  });
}

export async function POST() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const stuck = await findStuckConversations();
  const results: Array<{ conversationId: string; lead: string; ok: boolean; error?: string }> = [];
  const deadline = Date.now() + 45_000;

  for (const s of stuck) {
    if (Date.now() >= deadline) break;
    try {
      await processSdrResponse(s.conversationId, s.lastMessageContent, s.agent, s.lastMessageId);
      results.push({ conversationId: s.conversationId, lead: s.lead, ok: true });
    } catch (e) {
      results.push({ conversationId: s.conversationId, lead: s.lead, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ processed: results.length, remaining: stuck.length - results.length, results });
}
