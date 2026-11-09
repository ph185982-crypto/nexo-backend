// Começa a conexão com o Google: manda para a tela de consentimento com um "state" guardado em cookie.
import { randomBytes } from "node:crypto";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { credenciaisGoogle, enderecoDeRetorno, urlDeAutorizacao } from "@/lib/google/cliente";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  if (!credenciaisGoogle()) return Response.redirect(new URL("/configuracao?aba=google&google=sem_credenciais", req.url), 303);
  const state = randomBytes(24).toString("base64url");
  const destino = urlDeAutorizacao(enderecoDeRetorno(req), state);
  return new Response(null, {
    status: 303,
    headers: { location: destino, "set-cookie": `google_oauth_state=${state}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=600${process.env.NODE_ENV === "production" ? "; Secure" : ""}` },
  });
}
