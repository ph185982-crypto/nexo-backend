import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { invalidateGoogleCredentialCache } from "@/lib/integrations/google-calendar";

// GET /api/integrations/google/status — está conectado? qual email?
export async function GET() {
  const cred = await prisma.integrationCredential.findUnique({
    where: { provider: "GOOGLE_CALENDAR" },
    select: { email: true, calendarId: true, updatedAt: true },
  }).catch(() => null);

  // Fallback: env vars antigas ainda contam como "conectado"
  const viaEnv = !cred && !!process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;

  return NextResponse.json({
    connected: !!cred || viaEnv,
    email: cred?.email ?? (viaEnv ? "via variáveis de ambiente" : null),
    calendarId: cred?.calendarId ?? process.env.GOOGLE_CALENDAR_ID ?? "primary",
    connectedAt: cred?.updatedAt ?? null,
  });
}

// DELETE /api/integrations/google/status — desconectar
export async function DELETE() {
  await prisma.integrationCredential.deleteMany({
    where: { provider: "GOOGLE_CALENDAR" },
  }).catch(() => {});
  invalidateGoogleCredentialCache();
  return NextResponse.json({ ok: true });
}
