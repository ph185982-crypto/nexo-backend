import type { NextAuthConfig } from "next-auth";
import { decidirAcessoApi, normalizarCaminhoApi, paginaPublica } from "./rotas-publicas";
import { naZona } from "@/lib/zona-comercial";

/** Central: /sso/authorize do app "vendas" com o caminho de volta (o mesmo de avanteza-sso.ts#authorizeUrl, sem Node). */
export function urlLoginUnico(retorno: string, hub = process.env.AVANTEZA_HUB_URL || "https://app.avanteza.com.br"): string {
  const u = new URL("/sso/authorize", hub.replace(/\/$/, ""));
  u.searchParams.set("app", "vendas");
  u.searchParams.set("return", retorno.startsWith("/") && !retorno.startsWith("//") ? retorno : "/comercial");
  return u.toString();
}

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
      const caminhoApi = normalizarCaminhoApi(nextUrl.pathname);
      if (caminhoApi.startsWith("/api/")) {
        if (decidirAcessoApi(caminhoApi, isLoggedIn, request.headers) === "permitir") return true;
        return Response.json({ error: "Não autenticado" }, { status: 401 });
      }
      if (paginaPublica(nextUrl.pathname)) return true; // proposta pública do Comercial (/comercial/p/{token})
      const isOnCrm = nextUrl.pathname.startsWith("/crm") || nextUrl.pathname === "/comercial" || nextUrl.pathname.startsWith("/comercial/");
      if (isOnCrm) {
        if (isLoggedIn) return true;
        // Sob /comercial (endereço na Central) a entrada é pelo login único: a Central confere a sessão dela e
        // devolve a pessoa a esta mesma página (/comercial/api/sso/callback). /crm/* segue com a tela /login.
        if (naZona(nextUrl.pathname)) return Response.redirect(urlLoginUnico(nextUrl.pathname + nextUrl.search));
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
