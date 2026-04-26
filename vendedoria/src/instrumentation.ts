/**
 * Next.js Instrumentation — runs once when the server process starts.
 * On Vercel (serverless): only lightweight tasks — no persistent workers.
 * On Render/Docker (long-running): starts BullMQ workers + keep-alive.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Vercel is serverless — persistent workers and keep-alive loops don't work
  const isVercel = !!process.env.VERCEL;
  if (isVercel) return;

  // ── Keep-alive (prevents Render free-tier cold starts) ───────────────────
  const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:10000";
  setTimeout(() => {
    const ping = () =>
      fetch(`${BASE_URL}/api/keepalive`)
        .then(() => console.log("[Keepalive] OK"))
        .catch((e) => console.warn("[Keepalive] Failed:", String(e)));
    ping();
    setInterval(ping, 10 * 60 * 1000);
  }, 30_000);

  // ── BullMQ workers — only when Redis is configured ────────────────────────
  if (process.env.REDIS_URL) {
    try {
      const { startFollowUpWorker } = await import("./lib/queue/followup-queue");
      startFollowUpWorker();
      console.log("[Instrumentation] BullMQ follow-up worker started");
    } catch (e) {
      console.warn("[Instrumentation] BullMQ worker failed to start:", String(e));
    }

    try {
      const { scheduleAdminReports } = await import("./lib/queue/admin-report-queue");
      await scheduleAdminReports();
    } catch (e) {
      console.warn("[Instrumentation] Admin report scheduler failed:", String(e));
    }
  } else {
    console.warn("[Instrumentation] REDIS_URL not set — BullMQ disabled");
  }
}
