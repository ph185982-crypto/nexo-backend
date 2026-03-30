/**
 * Next.js Instrumentation — runs once when the server process starts.
 * Sets up an internal keep-alive loop that pings /api/keepalive every 10 minutes
 * to prevent Render free-tier cold starts.
 */
export async function register() {
  // Only run in Node.js runtime (not Edge), and only in production
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:10000";
  const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

  // Delay first ping by 30s to let the server finish starting up
  setTimeout(() => {
    const ping = () => {
      fetch(`${BASE_URL}/api/keepalive`)
        .then(() => console.log("[Keepalive] Internal ping OK"))
        .catch((e) => console.warn("[Keepalive] Internal ping failed:", String(e)));
    };

    ping(); // first immediate ping
    setInterval(ping, INTERVAL_MS);
  }, 30_000);
}
