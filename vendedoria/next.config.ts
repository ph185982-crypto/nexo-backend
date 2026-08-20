import type { NextConfig } from "next";

// Vercel = serverless (no standalone), Render/Docker = standalone
const isVercel = !!process.env.VERCEL;

const nextConfig: NextConfig = {
  ...(isVercel ? {} : { output: "standalone" }),

  // BullMQ + ioredis use Node.js built-ins (child_process, net, worker_threads)
  // that webpack cannot bundle. serverExternalPackages covers Route Handlers;
  // the webpack externals below cover the instrumentation.ts compilation pass.
  // @sparticuz/chromium carrega o binário do Chrome de dentro do próprio pacote,
  // então precisa ficar fora do bundle junto com o puppeteer.
  serverExternalPackages: [
    "bullmq",
    "ioredis",
    "bcryptjs",
    "puppeteer",
    "puppeteer-core",
    "@sparticuz/chromium",
  ],

  webpack(config, { isServer, nextRuntime }) {
    if (isServer && nextRuntime === "nodejs") {
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

    // instrumentation.ts também é compilada para o Edge. O import das filas ali
    // é dinâmico e nunca executa fora do runtime Node, mas o bundler segue a
    // referência mesmo assim — e um external "commonjs" no Edge vira módulo não
    // suportado, o que derruba o deploy. Resolver para false apaga a referência.
    if (nextRuntime === "edge") {
      config.resolve.alias = {
        ...config.resolve.alias,
        bullmq: false,
        ioredis: false,
      };
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
