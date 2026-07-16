// GET  /api/integrations/supabase/token — status (mascarado) do token Supabase
// POST /api/integrations/supabase/token — salva o token de migração no banco
//
// Auth first-run: se ainda não há registro no banco, aceita sem auth.
// Depois de configurado, exige Bearer CRON_SECRET para trocar.
// O token NUNCA vai para o repositório — só banco, em runtime.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET() {
  const cred = await prisma.integrationCredential.findUnique({
    where: { provider: "SUPABASE" },
    select: { refreshToken: true, updatedAt: true },
  }).catch(() => null);

  return NextResponse.json({
    configured: Boolean(cred?.refreshToken),
    updatedAt: cred?.updatedAt ?? null,
  });
}

export async function POST(req: NextRequest) {
  const existing = await prisma.integrationCredential.findUnique({
    where: { provider: "SUPABASE" },
    select: { refreshToken: true },
  }).catch(() => null);

  if (existing?.refreshToken) {
    const auth = req.headers.get("authorization");
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json(
        { error: "Unauthorized — token já configurado, envie Bearer CRON_SECRET para trocar" },
        { status: 401 },
      );
    }
  }

  let token: string | undefined;
  try {
    const body = await req.json() as { token?: string };
    token = body.token?.trim();
  } catch { /* body inválido */ }

  if (!token || !token.startsWith("sbp_") || token.length < 30) {
    return NextResponse.json(
      { ok: false, error: "token inválido: deve começar com sbp_" },
      { status: 400 },
    );
  }

  await prisma.integrationCredential.upsert({
    where:  { provider: "SUPABASE" },
    update: { refreshToken: token },
    create: { provider: "SUPABASE", refreshToken: token },
  });

  return NextResponse.json({ ok: true, token: `${token.slice(0, 8)}••••` });
}
