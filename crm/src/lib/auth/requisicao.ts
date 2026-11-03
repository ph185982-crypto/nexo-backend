import { prisma } from "@/lib/prisma";
import { COOKIE_SESSAO, segredoDaSessao, verificarSessao } from "./sessao";

// Conferir "o usuário ainda está ativo" a cada requisição custa uma consulta; guarda por poucos segundos.
// Desativar alguém vale em até TTL_ATIVO_MS (e na hora para quem chama invalidarCacheUsuario).
const TTL_ATIVO_MS = 10_000;
const cacheAtivo = new Map<string, { ativo: boolean; ate: number }>();
export const invalidarCacheUsuario = (id?: string) => (id ? cacheAtivo.delete(id) : cacheAtivo.clear());

async function usuarioAtivo(uid: string): Promise<boolean> {
  const agora = Date.now();
  const c = cacheAtivo.get(uid);
  if (c && c.ate > agora) return c.ativo;
  const ativo = Boolean((await prisma.usuario.findUnique({ where: { id: uid }, select: { ativo: true } }))?.ativo);
  if (cacheAtivo.size > 1000) cacheAtivo.clear();
  cacheAtivo.set(uid, { ativo, ate: agora + TTL_ATIVO_MS });
  return ativo;
}

/**
 * Lê o cookie da requisição e devolve o id do usuário logado (ou null). Cookie assinado de usuário
 * removido ou desativado não vale: sem isso, o acesso de quem saiu da equipe duraria até 7 dias.
 */
export async function usuarioDaRequisicao(req: Request): Promise<string | null> {
  const cookie = req.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${COOKIE_SESSAO}=([^;]+)`).exec(cookie);
  const s = await verificarSessao(m ? decodeURIComponent(m[1]) : null, segredoDaSessao());
  return s && (await usuarioAtivo(s.uid)) ? s.uid : null;
}

export const naoAutenticado = () => Response.json({ erro: "Não autenticado" }, { status: 401 });
