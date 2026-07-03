import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";

// GET /api/integrations/google/connect — inicia o fluxo OAuth do Google Calendar
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GOOGLE_CALENDAR_CLIENT_ID não configurado no servidor" },
      { status: 500 },
    );
  }

  const origin = process.env.NEXTAUTH_URL ?? req.nextUrl.origin;
  const redirectUri = `${origin.replace(/\/$/, "")}/api/integrations/google/callback`;
  const state = randomBytes(16).toString("hex");

  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/calendar openid email");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent"); // força refresh_token novo
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
