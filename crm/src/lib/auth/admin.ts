import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "./requisicao";

/** Dono padrão do que o sistema cria sozinho (tarefas de integração e de automação): o administrador ativo mais antigo. */
export async function primeiroAdminAtivo(): Promise<{ id: string } | null> {
  return prisma.usuario.findFirst({ where: { papel: "ADMIN", ativo: true }, orderBy: { criadoEm: "asc" }, select: { id: true } });
}

/** Só administrador mexe em configuração. Devolve o id do usuário ou a resposta de erro pronta (401/403). */
export async function exigirAdmin(req: Request): Promise<{ uid: string } | { resposta: Response }> {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return { resposta: naoAutenticado() };
  const u = await prisma.usuario.findUnique({ where: { id: uid }, select: { papel: true, ativo: true } });
  if (!u?.ativo || u.papel !== "ADMIN") return { resposta: Response.json({ erro: "Somente administradores" }, { status: 403 }) };
  return { uid };
}
