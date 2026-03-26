import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

/**
 * GET /api/debug/status?secret=<CRON_SECRET>
 *
 * Retorna o estado atual do sistema sem expor dados sensíveis.
 * Protegido pelo CRON_SECRET para evitar acesso público.
 *
 * Uso: https://vendedoria.onrender.com/api/debug/status?secret=SEU_CRON_SECRET
 */
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [providerConfigs, agents] = await Promise.all([
      prisma.whatsappProviderConfig.findMany({
        select: {
          id: true,
          accountName: true,
          businessPhoneNumberId: true,
          status: true,
          hasAccessToken: true,
          agent: {
            select: {
              id: true,
              kind: true,
              status: true,
              aiProvider: true,
              aiModel: true,
              systemPrompt: true,
            },
          },
        },
      }).catch(() => null),
      null,
    ]);

    // Fallback se o campo virtual hasAccessToken não existir no Prisma gerado
    const configs = await prisma.whatsappProviderConfig.findMany({
      select: {
        id: true,
        accountName: true,
        businessPhoneNumberId: true,
        status: true,
        accessToken: true,
        agent: {
          select: {
            id: true,
            kind: true,
            status: true,
            aiProvider: true,h
            aiModel: true,
            systemPrompt: true,
          },
        },
      },
    });

    const recentLeads = await prisma.lead.count();
    const recentMessages = await prisma.whatsappMessage.count();

    const status = {
      timestamp: new Date().toISOString(),
      env: {
        hasGoogleKey: !!process.env.GOOGLE_AI_API_KEY,
        hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
        hasOpenAiKey: !!process.env.OPENAI_API_KEY,
        hasMetaToken: !!process.env.META_WHATSAPP_ACCESS_TOKEN,
        hasMetaSecret: !!process.env.META_WHATSAPP_APP_SECRET,
        metaPhoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? "NOT SET",
        verifyToken: process.env.META_WHATSAPP_VERIFY_TOKEN ?? "NOT SET",
      },
      providerConfigs: configs.map((c) => ({
        id: c.id,
        accountName: c.accountName,
        businessPhoneNumberId: c.businessPhoneNumberId,
        status: c.status,
        hasAccessTokenInDb: !!c.accessToken,
        accessTokenPrefix: c.accessToken ? c.accessToken.slice(0, 10) + "..." : null,
        agent: c.agent
          ? {
              id: c.agent.id,
              kind: c.agent.kind,
              status: c.agent.status,
              aiProvider: c.agent.aiProvider,
              aiModel: c.agent.aiModel,
              systemPrompt: !!c.agent.systemPrompt,
            }
          : null,
      })),
      db: {
        totalLeads: recentLeads,
        totalMessages: recentMessages,
      },
    };

    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: "DB error", message: String(error) },
      { status: 500 }
    );
  }
}
