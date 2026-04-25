import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // ── Server-only packages ───────────────────────────────────────────────────
  // BullMQ + ioredis use Node.js built-ins (child_process, net, worker_threads,
  // crypto, string_decoder) that webpack cannot bundle.
  //
  // serverExternalPackages covers App Router Route Handlers.
  // The explicit webpack externals below cover instrumentation.ts, which is
  // compiled in a separate webpack pass that does NOT read serverExternalPackages.
  serverExternalPackages: ["bullmq", "ioredis"],

  webpack(config, { isServer }) {
    if (isServer) {
      const prev = Array.isArray(config.externals)
        ? config.externals
        : config.externals != null
          ? [config.externals as object]
          : [];
      config.externals = [
        ...prev,
        // Emit native require() calls instead of trying to bundle these packages.
        { bullmq: "commonjs bullmq", ioredis: "commonjs ioredis" },
      ];
    }
    return config;
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
