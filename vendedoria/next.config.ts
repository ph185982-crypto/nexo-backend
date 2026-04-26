import type { NextConfig } from "next";

// Vercel = serverless (no standalone), Render/Docker = standalone
const isVercel = !!process.env.VERCEL;

const nextConfig: NextConfig = {
  ...(isVercel ? {} : { output: "standalone" }),

  // BullMQ + ioredis use Node.js built-ins that webpack cannot bundle.
  serverExternalPackages: ["bullmq", "ioredis", "bcryptjs"],

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
