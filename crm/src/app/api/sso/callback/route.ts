// Volta da Central (Avanteza ID): /api/sso/callback?token=<JWT>. Confere o token, acha ou cria o usuário
// e abre a MESMA sessão do login por senha (cookie assinado). Qualquer falha volta para a tela de login
// com uma mensagem curta; o motivo técnico fica só no log do servidor.
import { caminhoInterno, verifyAvantezaToken } from "@/lib/avanteza-sso";
import { assinarSessao, cookieDeSessao, segredoDaSessao } from "@/lib/auth/sessao";
import { invalidarCacheUsuario } from "@/lib/auth/requisicao";
import { APP_SSO, usuarioDoSso } from "@/lib/auth/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const voltarAoLogin = (req: Request, erro: "sso" | "sso-desativado") =>
  new Response(null, { status: 302, headers: { location: new URL(`/login?erro=${erro}`, req.url).toString(), "cache-control": "no-store" } });

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  let identidade;
  try {
    identidade = await verifyAvantezaToken(token, { audience: APP_SSO });
  } catch (e) {
    console.warn(`[sso] token recusado: ${e instanceof Error ? e.message : "erro"}`);
    return voltarAoLogin(req, "sso");
  }

  try {
    const r = await usuarioDoSso(identidade);
    if (!r.ok) return voltarAoLogin(req, "sso-desativado");
    invalidarCacheUsuario(r.usuario.id);

    // O token só traz caminho interno; ainda assim confere que o destino fica neste mesmo endereço.
    const base = new URL(req.url);
    let destino = new URL(caminhoInterno(identidade.returnTo), base);
    if (destino.origin !== base.origin) destino = new URL("/", base);

    const sessao = await assinarSessao(r.usuario.id, segredoDaSessao());
    return new Response(null, {
      status: 302,
      headers: { location: destino.toString(), "set-cookie": cookieDeSessao(sessao), "cache-control": "no-store", "referrer-policy": "no-referrer" },
    });
  } catch (e) {
    console.error("[sso] falha ao abrir a sessão", e);
    return voltarAoLogin(req, "sso");
  }
}
