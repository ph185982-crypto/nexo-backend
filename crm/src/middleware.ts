// Tudo exige login, exceto: tela de login, /api/login, /api/health e /api/integracoes/*
// (esta última valida a chave de serviço dentro da própria rota).
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, verificarSessao } from "@/lib/auth/sessao";

const PUBLICOS = ["/login", "/api/login", "/api/health"];
const PUBLICO_PREFIXOS = ["/api/integracoes/", "/brand/", "/_next/"];

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
