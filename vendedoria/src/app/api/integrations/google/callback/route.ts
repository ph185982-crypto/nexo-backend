import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { invalidateGoogleCredentialCache } from "@/lib/integrations/google-calendar";

const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

// GET /api/integrations/google/callback — troca code por refresh_token e salva
export async function GET(req: NextRequest) {
  const origin = process.env.NEXTAUTH_URL ?? req.nextUrl.origin;
  const settingsUrl = (q: string) =>
    `${origin.replace(/\/$/, "")}/crm/settings?tab=integracoes&google=${q}`;

  const code  = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("google_oauth_state")?.value;

  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(settingsUrl("erro_state"));
  }

  const clientId     = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(settingsUrl("erro_config"));
  }

  const redirectUri = `${origin.replace(/\/$/, "")}/api/integrations/google/callback`;

  try {
    const res = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!res.ok) {
      console.error("[GoogleOAuth] Troca de code falhou:", await res.text());
      return NextResponse.redirect(settingsUrl("erro_token"));
    }

    const data = await res.json() as {
      refresh_token?: string;
      access_token?: string;
      id_token?: string;
    };

    if (!data.refresh_token) {
      // Acontece se o usuário já autorizou antes sem prompt=consent
      console.error("[GoogleOAuth] Sem refresh_token na resposta");
      return NextResponse.redirect(settingsUrl("erro_sem_refresh"));
    }

    // Extrai email do id_token (payload JWT, sem validação — só informativo)
    let email: string | null = null;
    if (data.id_token) {
      try {
        const payload = JSON.parse(
          Buffer.from(data.id_token.split(".")[1], "base64url").toString("utf8"),
        ) as { email?: string };
        email = payload.email ?? null;
      } catch { /* ignora */ }
    }

    await prisma.integrationCredential.upsert({
      where:  { provider: "GOOGLE_CALENDAR" },
      update: { refreshToken: data.refresh_token, email },
      create: { provider: "GOOGLE_CALENDAR", refreshToken: data.refresh_token, email },
    });
    invalidateGoogleCredentialCache();

    console.log(`[GoogleOAuth] Google Calendar conectado (${email ?? "email desconhecido"})`);
    const ok = NextResponse.redirect(settingsUrl("ok"));
    ok.cookies.delete("google_oauth_state");
    return ok;
  } catch (e) {
    console.error("[GoogleOAuth] Erro:", e);
    return NextResponse.redirect(settingsUrl("erro"));
  }
}
