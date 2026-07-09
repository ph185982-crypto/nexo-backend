// GET  /api/integrations/openai  — status da chave OpenAI (mascarada)
// POST /api/integrations/openai  — salva/atualiza chave no banco + invalida cache Max
//
// Auth: se não há chave configurada ainda (first-run), aceita sem auth.
//       Se já há chave, exige Bearer CRON_SECRET para trocar.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { invalidateOpenAIKeyCache } from "@/lib/max/openai";

function mask(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 8)}••••${key.slice(-4)}`;
}

export async function GET() {
  const cred = await prisma.integrationCredential.findUnique({
    where: { provider: "OPENAI" },
    select: { refreshToken: true, updatedAt: true },
  }).catch(() => null);

  const envKey = process.env.OPENAI_API_KEY;
  const key = cred?.refreshToken ?? envKey;

  return NextResponse.json({
    configured: Boolean(key),
    source: cred ? "banco" : envKey ? "env" : null,
    maskedKey: key ? mask(key) : null,
    updatedAt: cred?.updatedAt ?? null,
  });
}

export async function POST(req: NextRequest) {
  // Check if a key is already configured in the database
  const existing = await prisma.integrationCredential.findUnique({
    where: { provider: "OPENAI" },
    select: { refreshToken: true },
  }).catch(() => null);

  const alreadyConfigured = Boolean(existing?.refreshToken);

  // If already configured, require CRON_SECRET to change
  if (alreadyConfigured) {
    const auth = req.headers.get("authorization");
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized — chave já configurada, envie Bearer CRON_SECRET para trocar" }, { status: 401 });
    }
  }

  let key: string | undefined;
  try {
    const body = await req.json() as { key?: string };
    key = body.key?.trim();
  } catch {
    // body inválido
  }

  if (!key || !key.startsWith("sk-")) {
    return NextResponse.json(
      { ok: false, error: "Chave inválida: deve começar com sk-" },
      { status: 400 },
    );
  }

  // Valida a chave com uma chamada leve
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) {
      return NextResponse.json(
        { ok: false, error: "Chave OpenAI rejeitada pela API (401). Verifique a chave." },
        { status: 400 },
      );
    }
  } catch (e) {
    console.warn("[OpenAI integration] Validação falhou (rede) — salvando mesmo assim:", e);
  }

  await prisma.integrationCredential.upsert({
    where:  { provider: "OPENAI" },
    update: { refreshToken: key },
    create: { provider: "OPENAI", refreshToken: key },
  });

  invalidateOpenAIKeyCache();

  return NextResponse.json({ ok: true, maskedKey: mask(key) });
}
