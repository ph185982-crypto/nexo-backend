/**
 * TEMPORARY DIAGNOSTIC ENDPOINT — REMOVE AFTER USE
 * GET /api/debug/probe
 * Returns non-sensitive DB state to verify configuration without CRON_SECRET.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET() {
  try {
    const configs = await prisma.whatsappProviderConfig.findMany({
      select: {
        id: true,
        businessPhoneNumberId: true,
        status: true,
        accessToken: true,
        agent: {
          select: { kind: true, status: true, aiProvider: true, aiModel: true },
        },
      },
    });

    const envPhoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;

    return NextResponse.json({
      env: {
        phoneNumberId: envPhoneId ?? "NOT_SET",
        hasMetaToken: !!process.env.META_WHATSAPP_ACCESS_TOKEN,
        hasMetaSecret: !!process.env.META_WHATSAPP_APP_SECRET,
        hasGoogleKey: !!process.env.GOOGLE_AI_API_KEY,
        hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
        nextauthUrl: process.env.NEXTAUTH_URL ?? "NOT_SET",
      },
      providerConfigs: configs.map((c) => ({
        id: c.id,
        businessPhoneNumberId: c.businessPhoneNumberId,
        phoneIdMatchesEnv: c.businessPhoneNumberId === envPhoneId,
        status: c.status,
        hasAccessToken: !!c.accessToken,
        agent: c.agent
          ? { kind: c.agent.kind, status: c.agent.status, aiProvider: c.agent.aiProvider, aiModel: c.agent.aiModel }
          : null,
      })),
      leads: await prisma.lead.count(),
      messages: await prisma.whatsappMessage.count(),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
