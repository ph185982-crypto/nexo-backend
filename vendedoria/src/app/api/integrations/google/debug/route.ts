// GET /api/integrations/google/debug — diagnóstico de configuração do Google Calendar
// Requer Bearer CRON_SECRET (expõe detalhes de configuração).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { getGoogleOAuthApp } from "@/lib/integrations/google-oauth-app";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const app = await getGoogleOAuthApp();
  const nextauthUrl = process.env.NEXTAUTH_URL;

  const appCred = await prisma.integrationCredential.findUnique({
    where: { provider: "GOOGLE_OAUTH_APP" },
    select: { email: true, updatedAt: true },
  }).catch(() => null);

  const cred = await prisma.integrationCredential.findUnique({
    where: { provider: "GOOGLE_CALENDAR" },
    select: { email: true, calendarId: true, updatedAt: true, refreshToken: true },
  }).catch(() => null);

  return NextResponse.json({
    appClientId: app ? `${app.clientId.slice(0, 14)}...` : "NAO CONFIGURADO",
    appClientSecret: app ? "configurado" : "NAO CONFIGURADO",
    appSource: appCred ? "banco" : app ? "env" : null,
    envRefreshToken: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN ? "configurado" : "nao",
    nextauthUrl: nextauthUrl ?? "nao definido",
    expectedRedirectUri: `${(nextauthUrl ?? "https://srv1797517.hstgr.cloud").replace(/\/$/, "")}/api/integrations/google/callback`,
    dbCredential: cred ? {
      email: cred.email,
      calendarId: cred.calendarId,
      hasRefreshToken: !!cred.refreshToken,
      updatedAt: cred.updatedAt,
    } : null,
  });
}
