// Credenciais do app OAuth do Google (Client ID + Client Secret)
// Fonte (nesta ordem):
//   1. IntegrationCredential (provider "GOOGLE_OAUTH_APP") — clientId no campo email,
//      clientSecret no campo refreshToken (mesmo reaproveitamento do padrão RAPIDAPI/OPENAI)
//   2. Env vars: GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET

import { prisma } from "@/lib/prisma/client";

export interface GoogleOAuthApp {
  clientId: string;
  clientSecret: string;
}

let cache: GoogleOAuthApp | null | undefined;
let cacheAt = 0;
const CACHE_TTL_MS = 60_000;

export async function getGoogleOAuthApp(): Promise<GoogleOAuthApp | null> {
  const now = Date.now();
  if (cache !== undefined && now - cacheAt < CACHE_TTL_MS) return cache ?? null;

  let fromDb: GoogleOAuthApp | null = null;
  try {
    const cred = await prisma.integrationCredential.findUnique({
      where: { provider: "GOOGLE_OAUTH_APP" },
      select: { email: true, refreshToken: true },
    });
    if (cred?.email && cred.refreshToken) {
      fromDb = { clientId: cred.email, clientSecret: cred.refreshToken };
    }
  } catch { /* banco indisponível — cai no env */ }

  const envId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const envSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

  cache = fromDb ?? (envId && envSecret ? { clientId: envId, clientSecret: envSecret } : null);
  cacheAt = now;
  return cache;
}

export function invalidateGoogleOAuthAppCache(): void {
  cache = undefined;
  cacheAt = 0;
}
