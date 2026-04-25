import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

/**
 * GET /api/debug/status?secret=<CRON_SECRET>
 *
 * Full system diagnostic — tests DB, Meta API token, OpenAI, AgentConfig.
 * Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
  };

  // ── 1. Env vars snapshot ────────────────────────────────────────────────────
  results.env = {
    hasGoogleKey:      !!process.env.GOOGLE_AI_API_KEY,
    hasAnthropicKey:   !!process.env.ANTHROPIC_API_KEY,
    hasOpenAiKey:      !!process.env.OPENAI_API_KEY,
    hasMetaToken:      !!process.env.META_WHATSAPP_ACCESS_TOKEN,
    hasMetaSecret:     !!process.env.META_WHATSAPP_APP_SECRET,
    hasDatabaseUrl:    !!process.env.DATABASE_URL,
    hasRedisUrl:       !!process.env.REDIS_URL,
    metaPhoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? "NOT SET",
    verifyToken:       process.env.META_WHATSAPP_VERIFY_TOKEN ?? "NOT SET",
    nodeEnv:           process.env.NODE_ENV,
  };

  // ── 2. Database records ─────────────────────────────────────────────────────
  try {
    const [configs, agentConfig, recentMsgs, totalLeads, totalMessages] = await Promise.all([
      prisma.whatsappProviderConfig.findMany({
        select: {
          id: true, accountName: true, businessPhoneNumberId: true, status: true, accessToken: true,
          agent: { select: { id: true, kind: true, status: true, aiProvider: true, aiModel: true, systemPrompt: true } },
        },
      }),
      prisma.agentConfig.findFirst({
        select: { id: true, agentName: true, promptVersion: true, currentPrompt: true, followUpHours: true, maxFollowUps: true },
      }),
      prisma.whatsappMessage.findMany({
        orderBy: { sentAt: "desc" }, take: 5,
        select: { id: true, role: true, content: true, sentAt: true, conversationId: true },
      }),
      prisma.lead.count(),
      prisma.whatsappMessage.count(),
    ]);

    results.db = {
      connected: true,
      totalLeads,
      totalMessages,
      agentConfig: agentConfig ? {
        id: agentConfig.id,
        agentName: agentConfig.agentName,
        promptVersion: agentConfig.promptVersion,
        hasPrompt: !!agentConfig.currentPrompt,
        promptLength: agentConfig.currentPrompt?.length ?? 0,
        followUpHours: agentConfig.followUpHours,
        maxFollowUps: agentConfig.maxFollowUps,
      } : null,
      providerConfigs: configs.map((c) => ({
        id: c.id,
        accountName: c.accountName,
        businessPhoneNumberId: c.businessPhoneNumberId,
        status: c.status,
        hasAccessTokenInDb: !!c.accessToken,
        accessTokenPrefix: c.accessToken ? c.accessToken.slice(0, 12) + "..." : null,
        agent: c.agent ? {
          id: c.agent.id, kind: c.agent.kind, status: c.agent.status,
          aiProvider: c.agent.aiProvider, aiModel: c.agent.aiModel,
          hasSystemPrompt: !!c.agent.systemPrompt,
        } : null,
      })),
      last5Messages: recentMsgs.map((m) => ({
        role: m.role,
        preview: m.content.slice(0, 60),
        sentAt: m.sentAt,
        conversationId: m.conversationId,
      })),
    };
  } catch (e) {
    results.db = { connected: false, error: String(e) };
  }

  // ── 3. Meta API token test ──────────────────────────────────────────────────
  try {
    const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    if (!token) {
      results.metaApi = { ok: false, error: "META_WHATSAPP_ACCESS_TOKEN not set" };
    } else {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${phoneId}?fields=verified_name,display_phone_number,quality_rating`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json() as Record<string, unknown>;
      if (res.ok) {
        results.metaApi = {
          ok: true,
          status: res.status,
          phoneNumber: data.display_phone_number,
          verifiedName: data.verified_name,
          qualityRating: data.quality_rating,
        };
      } else {
        results.metaApi = {
          ok: false,
          status: res.status,
          error: data,
        };
      }
    }
  } catch (e) {
    results.metaApi = { ok: false, error: String(e) };
  }

  // ── 4. OpenAI API test ──────────────────────────────────────────────────────
  try {
    if (!process.env.OPENAI_API_KEY) {
      results.openai = { ok: false, error: "OPENAI_API_KEY not set" };
    } else {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Responda apenas: OK" }],
          max_tokens: 5,
        }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (res.ok) {
        const choices = data.choices as Array<{ message?: { content?: string } }>;
        results.openai = { ok: true, status: res.status, response: choices?.[0]?.message?.content };
      } else {
        results.openai = { ok: false, status: res.status, error: data };
      }
    }
  } catch (e) {
    results.openai = { ok: false, error: String(e) };
  }

  // ── 5. Recent webhook activity (last hour) ──────────────────────────────────
  try {
    const oneHourAgo = new Date(Date.now() - 3600_000);
    const [recentUserMsgs, recentAIMsgs] = await Promise.all([
      prisma.whatsappMessage.count({ where: { role: "USER", sentAt: { gte: oneHourAgo } } }),
      prisma.whatsappMessage.count({ where: { role: "ASSISTANT", sentAt: { gte: oneHourAgo } } }),
    ]);
    results.lastHour = { userMessages: recentUserMsgs, aiMessages: recentAIMsgs };
  } catch (e) {
    results.lastHour = { error: String(e) };
  }

  return NextResponse.json(results);
}
