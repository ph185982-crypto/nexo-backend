// Next.js Instrumentation — runs once when the server process starts.
export async function register() {
  // Only run in Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Validate required environment variables on startup
  const { validarConfig } = await import("@/lib/config/env");
  validarConfig();

  const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:10000";
  const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

  // Keep-alive loop to prevent Render free-tier cold starts
  setTimeout(() => {
    const ping = () => {
      fetch(`${BASE_URL}/api/keepalive`)
        .then(() => console.log("[Keepalive] Internal ping OK"))
        .catch((e) => console.warn("[Keepalive] Internal ping failed:", String(e)));
    };

    ping();
    setInterval(ping, KEEPALIVE_INTERVAL_MS);
  }, 30_000);

  // BullMQ workers — only start if Redis is configured
  if (process.env.REDIS_URL) {
    try {
      const { startFollowUpWorker } = await import("@/lib/queue/followup-queue");
      startFollowUpWorker();
      console.log("[Instrumentation] FollowUpWorker iniciado via BullMQ");
    } catch (err) {
      console.warn("[Instrumentation] FollowUpWorker falhou ao iniciar:", err);
    }

    // Admin report scheduler — relatórios diários 13h e 18h (Brasília)
    try {
      const { scheduleAdminReports } = await import("@/lib/queue/admin-report-queue");
      await scheduleAdminReports();
      console.log("[Instrumentation] AdminReport scheduler registrado (13h + 18h Brasília)");
    } catch (err) {
      console.warn("[Instrumentation] AdminReport scheduler falhou ao iniciar:", err);
    }
  } else {
    console.log("[Instrumentation] REDIS_URL não configurado — follow-ups via cron polling");
  }
}
