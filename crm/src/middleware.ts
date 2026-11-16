// Tudo exige login, exceto: tela de login, /api/login, /api/sso/callback (volta do login único; a rota confere o
// token assinado pela Central), /api/health, /api/integracoes/vendedor-ia/* e /api/integracoes/avanteza/entregas/* (chave de serviço)
// e /api/cron/* (CRON_SECRET) — as duas últimas validam a credencial dentro da própria rota —, e a proposta pública
// (/p/{token} e /api/publico/*: o token aleatório no endereço é a credencial).
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, verificarSessao } from "@/lib/auth/sessao";
import { bloqueioSomenteLeitura } from "@/lib/auth/somente-leitura";

const PUBLICOS = ["/login", "/api/login", "/api/sso/callback", "/api/health"];
const PUBLICO_PREFIXOS = ["/api/integracoes/vendedor-ia/", "/api/integracoes/avanteza/entregas", "/api/cron/", "/api/publico/", "/p/", "/brand/", "/_next/"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Congelado para o corte (CRM_SOMENTE_LEITURA=1): nada grava, nem rota pública; só GET passa (e /api/health).
  const congelado = bloqueioSomenteLeitura(req.method, pathname);
  if (congelado) return congelado;
  if (PUBLICOS.includes(pathname) || PUBLICO_PREFIXOS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const segredo = process.env.SESSION_SECRET;
  const sessao = segredo && segredo.length >= 16 ? await verificarSessao(req.cookies.get(COOKIE_SESSAO)?.value, segredo) : null;
  if (sessao) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  // Guarda o caminho pedido para voltar a ele depois de entrar (a tela de login só aceita caminho interno).
  if (pathname !== "/") url.searchParams.set("voltar", `${pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!favicon.ico).*)"] };
