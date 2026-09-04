// GET  /api/integrations/google/app-credentials — status (mascarado) das credenciais do app OAuth
// POST /api/integrations/google/app-credentials — salva Client ID + Client Secret no banco
//
// Auth first-run: se ainda não há registro no banco, aceita sem auth.
// Depois de configurado, exige Bearer CRON_SECRET para trocar.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { invalidateGoogleOAuthAppCache } from "@/lib/integrations/google-oauth-app";

export async function GET() {
  const cred = await prisma.integrationCredential.findUnique({
    where: { provider: "GOOGLE_OAUTH_APP" },
    select: { email: true, refreshToken: true, updatedAt: true },
  }).catch(() => null);

  const envId = process.env.GOOGLE_CALENDAR_CLIENT_ID;

  return NextResponse.json({
    configured: Boolean(cred?.refreshToken) || Boolean(envId && process.env.GOOGLE_CALENDAR_CLIENT_SECRET),
    source: cred?.refreshToken ? "banco" : envId ? "env" : null,
    clientId: cred?.email ?? envId ?? null,
    updatedAt: cred?.updatedAt ?? null,
  });
}

export async function POST(req: NextRequest) {
  const existing = await prisma.integrationCredential.findUnique({
    where: { provider: "GOOGLE_OAUTH_APP" },
    select: { refreshToken: true },
  }).catch(() => null);

  if (existing?.refreshToken) {
    const auth = req.headers.get("authorization");
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json(
        { error: "Unauthorized — credenciais já configuradas, envie Bearer CRON_SECRET para trocar" },
        { status: 401 },
      );
    }
  }

  let clientId: string | undefined;
  let clientSecret: string | undefined;
  try {
    const body = await req.json() as { clientId?: string; clientSecret?: string };
    clientId = body.clientId?.trim();
    clientSecret = body.clientSecret?.trim();
  } catch { /* body inválido */ }

  if (!clientId || !clientId.endsWith(".apps.googleusercontent.com")) {
    return NextResponse.json(
      { ok: false, error: "clientId inválido: deve terminar com .apps.googleusercontent.com" },
      { status: 400 },
    );
  }
  if (!clientSecret || clientSecret.length < 10) {
    return NextResponse.json(
      { ok: false, error: "clientSecret inválido ou muito curto" },
      { status: 400 },
    );
  }

  await prisma.integrationCredential.upsert({
    where:  { provider: "GOOGLE_OAUTH_APP" },
    update: { email: clientId, refreshToken: clientSecret },
    create: { provider: "GOOGLE_OAUTH_APP", email: clientId, refreshToken: clientSecret },
  });

  invalidateGoogleOAuthAppCache();

  return NextResponse.json({
    ok: true,
    clientId,
    clientSecret: `${clientSecret.slice(0, 6)}••••`,
  });
}
