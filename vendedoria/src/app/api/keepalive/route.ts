import { NextResponse } from "next/server";

/**
 * GET /api/keepalive
 * Keeps the Render free-tier service awake AND triggers the follow-up worker.
 * Configure UptimeRobot to ping this URL every 5 minutes.
 */
export async function GET(req: Request) {
  const baseUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;

  // Fire follow-up worker asynchronously (don't block the health response)
  fetch(`${baseUrl}/api/cron/followup`).catch(() => {});

  return NextResponse.json({ alive: true, ts: Date.now() });
}
