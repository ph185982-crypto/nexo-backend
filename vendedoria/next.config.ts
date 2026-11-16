import type { NextConfig } from "next";
import { ALIASES_LEGADOS, ARQUIVOS_PUBLICOS, PREFIXO_LEGADO_GENERICO, ZONA } from "./src/lib/zona-comercial";

// Vercel = serverless (no standalone), Render/Docker = standalone
const isVercel = !!process.env.VERCEL;

const nextConfig: NextConfig = {
  ...(isVercel ? {} : { output: "standalone" }),

  // Endereço único (app.avanteza.com.br/comercial/*, reescrita na Central — ver src/lib/zona-comercial.ts).
  // SEM basePath: /api/webhooks/whatsapp e /api/webhooks/clicksign continuam onde estão. Os arquivos do Next
  // saem como /comercial/_next/… (a Central repassa /comercial/* para cá) e a reescrita "beforeFiles" abaixo
  // os devolve a /_next/… — nos dois domínios. Reverter = apagar assetPrefix e images.path.
  assetPrefix: ZONA,

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
      { source: "/comercial/api/comercial/publico/:path*", headers: privado },
    ];
  },

  async rewrites() {
    const zonaAntes = [
      { source: `${ZONA}/_next/:path*`, destination: "/_next/:path*" },
      ...ARQUIVOS_PUBLICOS.flatMap((a) => [
        { source: `${ZONA}${a}`, destination: a },
        ...(a.includes(".") ? [] : [{ source: `${ZONA}${a}/:path*`, destination: `${a}/:path*` }]),
      ]),
    ];
    const zonaDepois = [
      // Telas antigas do Vendedor IA também sob /comercial (o domínio antigo segue abrindo /crm/*).
      ...ALIASES_LEGADOS.flatMap(({ zona, legado }) => [
        { source: zona, destination: legado },
        { source: `${zona}/:path*`, destination: `${legado}/:path*` },
      ]),
      { source: PREFIXO_LEGADO_GENERICO, destination: "/crm" },
      { source: `${PREFIXO_LEGADO_GENERICO}/:path*`, destination: "/crm/:path*" },
    ];
    return { beforeFiles: zonaAntes, afterFiles: [
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/metadata/recurso" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/metadata/recurso" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata/servidor" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata/servidor" },
      // Comercial: a API também responde em /comercial/api/* (endereço sob a Central, ver src/lib/api-url.ts).
      // O middleware cobre /comercial/* e normaliza o prefixo antes de decidir o acesso (rotas-publicas.ts).
      { source: "/comercial/api/:path*", destination: "/api/:path*" },
      ...zonaDepois,
    ], fallback: [] };
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
    path: `${ZONA}/_next/image`,
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
