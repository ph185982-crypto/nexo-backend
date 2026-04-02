import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    turbo: {},
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
