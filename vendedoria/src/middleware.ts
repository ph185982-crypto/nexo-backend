import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/config";

// Middleware usa apenas o config Edge-safe (sem Prisma/bcrypt).
// O Credentials provider só é carregado no runtime Node.js (index.ts).
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/crm/:path*"],
};
