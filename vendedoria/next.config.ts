import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // BullMQ + ioredis use Node.js built-ins (child_process, net, worker_threads)
  // that webpack cannot bundle. serverExternalPackages covers Route Handlers;
  // the webpack externals below cover the instrumentation.ts compilation pass.
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
