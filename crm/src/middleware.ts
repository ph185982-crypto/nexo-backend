// Tudo exige login, exceto: tela de login, /api/login, /api/health, /api/integracoes/* (chave de serviço)
// e /api/cron/* (CRON_SECRET) — as duas últimas validam a credencial dentro da própria rota —, e a proposta pública
// (/p/{token} e /api/publico/*: o token aleatório no endereço é a credencial).
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, verificarSessao } from "@/lib/auth/sessao";

const PUBLICOS = ["/login", "/api/login", "/api/health"];
const PUBLICO_PREFIXOS = ["/api/integracoes/", "/api/cron/", "/api/publico/", "/p/", "/brand/", "/_next/"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLICOS.includes(pathname) || PUBLICO_PREFIXOS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const segredo = process.env.SESSION_SECRET;
  const sessao = segredo && segredo.length >= 16 ? await verificarSessao(req.cookies.get(COOKIE_SESSAO)?.value, segredo) : null;
  if (sessao) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!favicon.ico).*)"] };
