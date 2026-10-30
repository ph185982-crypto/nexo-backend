import type { NextAuthConfig } from "next-auth";
import { decidirAcessoApi } from "./rotas-publicas";

// Edge-safe config: sem imports de Prisma ou bcrypt.
// Usado pelo middleware (Edge runtime) e estendido em index.ts com os providers.
export const authConfig: NextAuthConfig = {
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    authorized({ auth, request }) {
      const { nextUrl } = request;
      const isLoggedIn = !!auth?.user;
      if (nextUrl.pathname.startsWith("/api/")) {
        if (decidirAcessoApi(nextUrl.pathname, isLoggedIn, request.headers) === "permitir") return true;
        return Response.json({ error: "Não autenticado" }, { status: 401 });
      }
      const isOnCrm = nextUrl.pathname.startsWith("/crm");
      if (isOnCrm) {
        if (isLoggedIn) return true;
        return false;
      } else if (isLoggedIn && nextUrl.pathname === "/login") {
        return Response.redirect(new URL("/crm", nextUrl));
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  providers: [], // preenchido em index.ts (Node.js runtime)
};
