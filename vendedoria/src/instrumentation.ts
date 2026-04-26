/**
 * Next.js Instrumentation — runs once when the server process starts.
 * Initialises: keep-alive loop + BullMQ follow-up worker.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // ── Keep-alive (prevents Render free-tier cold starts) ───────────────────
  const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:10000";
  setTimeout(() => {
    const ping = () => fetch(`${BASE_URL}/api/keepalive`)
      .then(() => console.log("[Keepalive] OK"))
      .catch((e) => console.warn("[Keepalive] Failed:", String(e)));
    ping();
    setInterval(ping, 10 * 60 * 1000);
  }, 30_000);

  // ── BullMQ Follow-up Worker ───────────────────────────────────────────────
  // Only start if Redis is configured — gracefully skip otherwise
  if (process.env.REDIS_URL) {
    try {
      const { startFollowUpWorker } = await import("./lib/queue/followup-queue");
      startFollowUpWorker();
      console.log("[Instrumentation] BullMQ follow-up worker started");
    } catch (e) {
      console.warn("[Instrumentation] BullMQ worker failed to start:", String(e));
    }

    // ── Admin Report Scheduler (13h & 18h Brasília) ─────────────────────────
    try {
      const { scheduleAdminReports } = await import("./lib/queue/admin-report-queue");
      await scheduleAdminReports();
    } catch (e) {
      console.warn("[Instrumentation] Admin report scheduler failed:", String(e));
    }
  } else {
    console.warn("[Instrumentation] REDIS_URL not set — follow-up worker disabled (cron fallback active)");
  }
}
