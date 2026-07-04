// GET  /api/integrations/rapidapi  — status da chave RapidAPI (mascarada)
// POST /api/integrations/rapidapi  — valida e salva a chave no banco
//
// A chave fica em IntegrationCredential (provider "RAPIDAPI", campo refreshToken),
// mesmo modelo usado pelo Google Calendar. O sourcing lê banco → fallback env.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { invalidateRapidApiKeyCache } from "@/lib/prospeccao/sourcing";

const RAPIDAPI_HOST = "local-business-data.p.rapidapi.com";

function mask(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export async function GET() {
  const cred = await prisma.integrationCredential.findUnique({
    where: { provider: "RAPIDAPI" },
    select: { refreshToken: true, updatedAt: true },
  });

  const envKey = process.env.RAPIDAPI_KEY;
  const key = cred?.refreshToken ?? envKey;

  return NextResponse.json({
    configured: Boolean(key),
    source: cred ? "banco" : envKey ? "env" : null,
    maskedKey: key ? mask(key) : null,
    updatedAt: cred?.updatedAt ?? null,
  });
}

export async function POST(req: NextRequest) {
  let key: string | undefined;
  try {
    const body = await req.json() as { key?: string };
    key = body.key?.trim();
  } catch {
    // body inválido
  }

  if (!key || key.length < 20) {
    return NextResponse.json(
      { ok: false, error: "Chave inválida: informe a chave RapidAPI completa" },
      { status: 400 },
    );
  }

  // Valida a chave com uma busca real barata
  try {
    const params = new URLSearchParams({
      query: "restaurante em São Paulo",
      limit: "1",
      region: "br",
      language: "pt",
    });
    const res = await fetch(`https://${RAPIDAPI_HOST}/search?${params}`, {
      headers: {
        "x-rapidapi-host": RAPIDAPI_HOST,
        "x-rapidapi-key": key,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        { ok: false, error: "Chave RapidAPI rejeitada (não autorizada). Verifique a chave e a assinatura da API Local Business Data." },
        { status: 400 },
      );
    }
    // 429 (limite) ainda indica chave válida; outros erros de servidor não bloqueiam o save
  } catch (e) {
    console.warn("[RapidAPI] Validação da chave falhou (rede) — salvando mesmo assim:", e);
  }

  await prisma.integrationCredential.upsert({
    where:  { provider: "RAPIDAPI" },
    update: { refreshToken: key },
    create: { provider: "RAPIDAPI", refreshToken: key },
  });
  invalidateRapidApiKeyCache();

  return NextResponse.json({ ok: true, maskedKey: mask(key) });
}
