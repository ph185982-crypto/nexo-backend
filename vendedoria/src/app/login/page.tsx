import { authorizeUrl, caminhoInterno } from "@/lib/avanteza-sso";
import { APP_SSO } from "@/lib/auth/sso";
import { FormLogin } from "./form-login";

export const dynamic = "force-dynamic";

// Mensagem curta para a volta do login único que não deu certo (o motivo técnico fica no log do servidor).
const ERROS: Record<string, string> = {
  sso: "Não foi possível entrar com a Avanteza. Tente de novo ou use e-mail e senha.",
};

/** O NextAuth manda `callbackUrl` como endereço completo; daqui só sai o caminho (nunca outro site). */
function caminhoPedido(callbackUrl: string | undefined): string {
  if (!callbackUrl) return "/";
  if (callbackUrl.startsWith("/")) return caminhoInterno(callbackUrl);
  try {
    const u = new URL(callbackUrl);
    return caminhoInterno(`${u.pathname}${u.search}`);
  } catch {
    return "/";
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string | string[]; callbackUrl?: string | string[] }> }) {
  const sp = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <FormLogin entrarComAvanteza={authorizeUrl(APP_SSO, caminhoPedido(um(sp.callbackUrl)))} erroInicial={ERROS[um(sp.erro) ?? ""] ?? ""} />;
}
