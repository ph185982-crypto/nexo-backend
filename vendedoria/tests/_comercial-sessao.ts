// Sessão dos testes do Comercial: no lugar do cookie assinado do CRM antigo, um cookie de teste que o leitor
// instalado aqui entende (fora de uma requisição do Next não há NextAuth). Importar este módulo instala o leitor.
import { definirLeitorDeSessao } from "@/lib/comercial/auth/requisicao";

export const COOKIE_SESSAO = "sessao-teste";
export async function assinarSessao(uid: string, _segredo?: string): Promise<string> {
  return encodeURIComponent(uid);
}

definirLeitorDeSessao(async (req) => {
  const m = /(?:^|;\s*)sessao-teste=([^;]+)/.exec(req?.headers.get("cookie") ?? "");
  return m ? decodeURIComponent(m[1]) : null;
});
