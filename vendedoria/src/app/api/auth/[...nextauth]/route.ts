import { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { normalizarCaminhoApi } from "@/lib/auth/rotas-publicas";

// Sob a Central (app.avanteza.com.br/comercial) o NextAuth responde em /comercial/api/auth/* (reescrita em
// next.config.ts). O NextAuth descobre a ação pelo caminho da URL, então tira o prefixo da zona antes.
// Cookies de sessão: nomes do NextAuth (authjs.*), sem Domain, então ficam no host em que a pessoa está —
// não colidem com o da Central (avz_session). Redirecionamentos do NextAuth são relativos ao host (trustHost).
function semZona(req: NextRequest): NextRequest {
  const u = new URL(req.url);
  const caminho = normalizarCaminhoApi(u.pathname);
  if (caminho === u.pathname) return req;
  u.pathname = caminho;
  return new NextRequest(u, req);
}

export const GET = (req: NextRequest) => handlers.GET(semZona(req));
export const POST = (req: NextRequest) => handlers.POST(semZona(req));
