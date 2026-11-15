import { authorizeUrl, caminhoInterno } from "@/lib/avanteza-sso";
import { APP_SSO } from "@/lib/auth/sso";
import { FormLogin } from "./form-login";

export const dynamic = "force-dynamic";

// Mensagens curtas para a volta do login único que não deu certo (o motivo técnico fica no log do servidor).
const ERROS: Record<string, string> = {
  sso: "Não foi possível entrar com a Avanteza. Tente de novo ou use e-mail e senha.",
  "sso-desativado": "Seu acesso ao CRM está desativado. Fale com o administrador.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string | string[]; voltar?: string | string[] }> }) {
  const sp = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const voltar = caminhoInterno(um(sp.voltar));
  return <FormLogin entrarComAvanteza={authorizeUrl(APP_SSO, voltar)} voltar={voltar} erroInicial={ERROS[um(sp.erro) ?? ""] ?? null} />;
}
