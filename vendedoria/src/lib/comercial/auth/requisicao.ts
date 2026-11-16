// Adaptador de autenticação do Comercial: mesma assinatura do CRM (usuarioDaRequisicao), agora sobre a
// sessão do NextAuth do Vendedor IA. Usuário desativado (User.ativo = false) não passa.
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma/client";

// Conferir "o usuário ainda está ativo" a cada requisição custa uma consulta; guarda por poucos segundos.
const TTL_ATIVO_MS = 10_000;
const cacheAtivo = new Map<string, { ativo: boolean; ate: number }>();
export const invalidarCacheUsuario = (id?: string) => (id ? cacheAtivo.delete(id) : cacheAtivo.clear());

async function usuarioAtivo(uid: string): Promise<boolean> {
  const agora = Date.now();
  const c = cacheAtivo.get(uid);
  if (c && c.ate > agora) return c.ativo;
  const ativo = Boolean((await prisma.user.findUnique({ where: { id: uid }, select: { ativo: true } }))?.ativo);
  if (cacheAtivo.size > 1000) cacheAtivo.clear();
  cacheAtivo.set(uid, { ativo, ate: agora + TTL_ATIVO_MS });
  return ativo;
}

type LeitorDeSessao = (req?: Request) => Promise<string | null>;
const leitorPadrao: LeitorDeSessao = async () => {
  const s = await auth();
  return (s?.user as { id?: string } | undefined)?.id ?? null;
};
let leitor: LeitorDeSessao = leitorPadrao;
/** Testes trocam a leitura da sessão (fora de uma requisição do Next não há cookies). null volta ao NextAuth. */
export function definirLeitorDeSessao(f: LeitorDeSessao | null) { leitor = f ?? leitorPadrao; }

/** Id do usuário logado (sessão do NextAuth) ou null. A requisição só é lida pelo leitor de teste. */
export async function usuarioDaRequisicao(req?: Request): Promise<string | null> {
  let uid: string | null = null;
  try {
    uid = await leitor(req);
  } catch {
    return null;
  }
  if (!uid || uid.startsWith("servico-")) return null; // sessão de serviço da Central não opera o Comercial
  return (await usuarioAtivo(uid)) ? uid : null;
}

export const naoAutenticado = () => Response.json({ erro: "Não autenticado" }, { status: 401 });
