// Volta da Central (Avanteza ID): /api/sso/callback?token=<JWT>.
// Confere o token e abre a MESMA sessão do login por senha, pelo NextAuth: o provider "avanteza-sso"
// (lib/auth/index.ts) recebe o token, confere de novo e acha ou cria o usuário. Qualquer falha volta para a
// tela de login com uma mensagem curta; o motivo técnico fica só no log do servidor.
import { NextRequest } from "next/server";
import { signIn } from "@/lib/auth";
import { APP_SSO, PROVIDER_SSO } from "@/lib/auth/sso";
import { caminhoInterno, verifyAvantezaToken } from "@/lib/avanteza-sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Location relativo: o navegador resolve no endereço em que a pessoa já está (não depende de NEXTAUTH_URL).
const ir = (caminho: string) => new Response(null, { status: 302, headers: { Location: caminho, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  let destino: string;
  try {
    const identidade = await verifyAvantezaToken(token, { audience: APP_SSO });
    destino = caminhoInterno(identidade.returnTo);
  } catch (e) {
    console.warn(`[Auth] Login único: token recusado (${e instanceof Error ? e.message : "erro"})`);
    return ir("/login?erro=sso");
  }

  try {
    // redirect: false → só grava o cookie de sessão; quem decide o destino é esta rota.
    await signIn(PROVIDER_SSO, { token, redirect: false });
  } catch (e) {
    console.error(`[Auth] Login único: não foi possível abrir a sessão (${e instanceof Error ? e.name : "erro"})`);
    return ir("/login?erro=sso");
  }
  return ir(destino === "/" ? "/crm" : destino);
}
