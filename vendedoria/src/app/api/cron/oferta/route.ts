import { NextRequest, NextResponse } from "next/server";
import { enviarOferta } from "@/lib/ofertas/enviador";

/**
 * POST /api/cron/oferta
 *
 * Called every 30 minutes via cron.
 * Internally checks if the current Brasília time matches one of 15 scheduled slots.
 * If yes, fires the full offer pipeline (art + caption + WhatsApp send).
 *
 * Brasília schedules (UTC-3):
 *   06:30 08:00 08:30 10:00 10:30 12:00 12:30 14:00 14:30 16:00 16:30 18:00 18:30 20:00 21:30
 *
 * Supports ?force=1 query param (or Authorization header) to bypass time check (for testing).
 */

// [hour, minute] in Brasília time (UTC-3)
const HORARIOS_BRASILIA: [number, number][] = [
  [6, 30],
  [8, 0],
  [8, 30],
  [10, 0],
  [10, 30],
  [12, 0],
  [12, 30],
  [14, 0],
  [14, 30],
  [16, 0],
  [16, 30],
  [18, 0],
  [18, 30],
  [20, 0],
  [21, 30],
];

// Tolerance: ±15 min around each scheduled slot
const TOLERANCE_MS = 15 * 60 * 1000;

function isHorarioOferta(now: Date): boolean {
  // Convert to Brasília time (UTC-3)
  const brasiliaOffset = -3 * 60; // minutes
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const brasiliaMs = utcMs + brasiliaOffset * 60 * 1000;
  const brasilia = new Date(brasiliaMs);

  const hNow = brasilia.getHours();
  const mNow = brasilia.getMinutes();
  const nowTotalMin = hNow * 60 + mNow;

  for (const [h, m] of HORARIOS_BRASILIA) {
    const slotTotalMin = h * 60 + m;
    const diffMs = Math.abs(nowTotalMin - slotTotalMin) * 60 * 1000;
    if (diffMs <= TOLERANCE_MS) return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";

  // Auth check (skip if no secret configured — open endpoint warning)
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  if (!force && !isHorarioOferta(now)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Fora do horário de oferta",
      time: now.toISOString(),
    });
  }

  try {
    const resultado = await enviarOferta();
    return NextResponse.json({ ...resultado, time: now.toISOString() });
  } catch (err) {
    console.error("[cron/oferta] erro:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

// Allow GET for easy manual trigger from browser/curl during development
export async function GET(req: NextRequest) {
  return POST(req);
}
