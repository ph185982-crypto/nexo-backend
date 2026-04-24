import Redis from "ioredis";

// ─── Redis singleton — re-used across hot-reloads in Next.js dev ─────────────
// REDIS_URL accepts: redis://host:port or redis://:password@host:port

declare global {
  // eslint-disable-next-line no-var
  var _redisClient: Redis | undefined;
}

function createRedisClient(): Redis {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const client = new Redis(url, {
    maxRetriesPerRequest: null, // required by BullMQ
    lazyConnect: true,
    connectTimeout: 5000,
    retryStrategy: (times) => {
      if (times > 10) return null; // stop retrying after 10 attempts
      return Math.min(times * 500, 5000);
    },
  });

  client.on("connect", () => console.log("[Redis] Connected"));
  client.on("error", (err) => console.error("[Redis] Error:", err.message));

  return client;
}

export function getRedisClient(): Redis {
  if (process.env.NODE_ENV === "development") {
    // Re-use across hot-reloads in dev
    if (!global._redisClient) global._redisClient = createRedisClient();
    return global._redisClient;
  }
  // In production each instance is persistent
  if (!global._redisClient) global._redisClient = createRedisClient();
  return global._redisClient;
}

/** Returns true if Redis is reachable (used for health checks) */
export async function isRedisAvailable(): Promise<boolean> {
  try {
    const client = getRedisClient();
    await client.ping();
    return true;
  } catch {
    return false;
  }
}
