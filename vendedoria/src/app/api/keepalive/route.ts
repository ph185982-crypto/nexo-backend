import { NextResponse } from "next/server";

/**
 * GET /api/keepalive
 *
 * Endpoint leve para manter o serviço Render acordado.
 * Configure um monitor externo gratuito (ex: UptimeRobot, Freshping, cron-job.org)
 * para fazer GET nesta URL a cada 5 minutos.
 *
 * URL: https://vendedoria.onrender.com/api/keepalive
 * Interval: 5 minutes
 */
export async function GET() {
  return NextResponse.json({ alive: true, ts: Date.now() });
}
