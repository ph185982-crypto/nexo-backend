import { prisma } from "@/lib/prisma/client";
import { naoAutenticado, usuarioDaRequisicao } from "./requisicao";

/** Dono padrão do que o sistema cria sozinho (tarefas de integração e de automação): o administrador ativo mais antigo. */
export async function primeiroAdminAtivo(): Promise<{ id: string } | null> {
  return prisma.user.findFirst({ where: { role: "ADMIN", ativo: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
}

/** Só administrador mexe em configuração. Devolve o id do usuário ou a resposta de erro pronta (401/403). */
export async function exigirAdmin(req: Request): Promise<{ uid: string } | { resposta: Response }> {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return { resposta: naoAutenticado() };
  const u = await prisma.user.findUnique({ where: { id: uid }, select: { role: true, ativo: true } });
  if (!u?.ativo || u.role !== "ADMIN") return { resposta: Response.json({ erro: "Somente administradores" }, { status: 403 }) };
  return { uid };
}

/** Usuários que podem ser responsáveis (ativos), no formato do Comercial. */
export async function usuariosAtivos(): Promise<Array<{ id: string; nome: string }>> {
  const us = await prisma.user.findMany({ where: { ativo: true }, orderBy: [{ name: "asc" }, { email: "asc" }], select: { id: true, name: true, email: true } });
  return us.map((u) => ({ id: u.id, nome: u.name ?? u.email ?? "Sem nome" }));
}

/** Nome de exibição de um usuário. */
export const nomeUsuario = (u: { name: string | null; email?: string | null } | null | undefined) => (u ? (u.name ?? u.email ?? "Sem nome") : null);
