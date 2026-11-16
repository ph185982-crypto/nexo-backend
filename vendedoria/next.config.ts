import type { NextConfig } from "next";

// Vercel = serverless (no standalone), Render/Docker = standalone
const isVercel = !!process.env.VERCEL;

const nextConfig: NextConfig = {
  ...(isVercel ? {} : { output: "standalone" }),

  // BullMQ + ioredis use Node.js built-ins (child_process, net, worker_threads)
  // that webpack cannot bundle. serverExternalPackages covers Route Handlers;
  // the webpack externals below cover the instrumentation.ts compilation pass.
  serverExternalPackages: [
    "bullmq",
    "ioredis",
    "bcryptjs",
  ],

  // Pastas começando com "." não viram rota no App Router: o discovery OAuth
  // do MCP (/.well-known/...) é redirecionado internamente para /api/oauth/metadata.
  // Proposta pública do Comercial: fora de buscadores e sem cache (cada abertura conta e o status muda).
  async headers() {
    const privado = [
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Cache-Control", value: "no-store, max-age=0" },
    ];
    return [
      { source: "/comercial/p/:path*", headers: privado },
      { source: "/api/comercial/publico/:path*", headers: privado },
    ];
  },

  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/metadata/recurso" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/metadata/recurso" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata/servidor" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata/servidor" },
      // Comercial: a API também responde em /comercial/api/* (endereço sob a Central, ver src/lib/api-url.ts).
      // O middleware cobre /comercial/* e normaliza o prefixo antes de decidir o acesso (rotas-publicas.ts).
      { source: "/comercial/api/:path*", destination: "/api/:path*" },
    ];
  },

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
