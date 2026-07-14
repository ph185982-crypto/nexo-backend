// GET /api/integrations/google/debug — diagnóstico de configuração do Google Calendar
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  const nextauthUrl = process.env.NEXTAUTH_URL;

  const cred = await prisma.integrationCredential.findUnique({
    where: { provider: "GOOGLE_CALENDAR" },
    select: { email: true, calendarId: true, updatedAt: true, refreshToken: true },
  }).catch(() => null);

  return NextResponse.json({
    clientId: clientId ? `${clientId.slice(0, 10)}...` : "NAO CONFIGURADO",
    clientSecret: clientSecret ? "configurado" : "NAO CONFIGURADO",
    envRefreshToken: refreshToken ? "configurado" : "nao",
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
