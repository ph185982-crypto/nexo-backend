import type { NextConfig } from "next";

const producao = process.env.NODE_ENV === "production";

// CSP: tudo do próprio domínio. 'unsafe-inline' em script/style porque o Next injeta o código de
// hidratação inline (sem nonce por requisição). Em desenvolvimento a CSP fica de fora (HMR usa eval).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const cabecalhosComuns = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(producao ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }, { key: "Content-Security-Policy", value: csp }] : []),
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["bcryptjs"],
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: cabecalhosComuns },
      // Resposta da API tem dado de cliente: nunca em cache de navegador nem de intermediário.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
