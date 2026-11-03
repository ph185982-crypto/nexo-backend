import { COOKIE_SESSAO, segredoDaSessao, verificarSessao } from "./sessao";

/** Lê o cookie da requisição e devolve o id do usuário logado (ou null). */
export async function usuarioDaRequisicao(req: Request): Promise<string | null> {
  const cookie = req.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${COOKIE_SESSAO}=([^;]+)`).exec(cookie);
  const s = await verificarSessao(m ? decodeURIComponent(m[1]) : null, segredoDaSessao());
  return s?.uid ?? null;
}

export const naoAutenticado = () => Response.json({ erro: "Não autenticado" }, { status: 401 });
