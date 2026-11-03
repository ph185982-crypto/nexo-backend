import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ErroEntrada } from "@/lib/validar";
import { invalidarCacheUsuario } from "@/lib/auth/requisicao";

export const PAPEIS = ["ADMIN", "VENDEDOR"] as const;
export const SENHA_MINIMA = 10;
const publico = { id: true, nome: true, email: true, papel: true, ativo: true, criadoEm: true } as const;

export const listarUsuarios = () => prisma.usuario.findMany({ orderBy: { criadoEm: "asc" }, select: publico });

export async function criarUsuario(d: { nome: string; email: string; senha: string; papel: string }) {
  if (d.senha.length < SENHA_MINIMA) throw new ErroEntrada(`A senha precisa ter ao menos ${SENHA_MINIMA} caracteres`);
  if (!/^\S+@\S+\.\S+$/.test(d.email)) throw new ErroEntrada("E-mail inválido");
  try {
    return await prisma.usuario.create({ data: { nome: d.nome, email: d.email.toLowerCase(), papel: d.papel, senhaHash: await bcrypt.hash(d.senha, 10) }, select: publico });
  } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ErroEntrada("Já existe um usuário com esse e-mail"); throw e; }
}

/** Nunca deixa o sistema sem administrador ativo e não deixa ninguém se desativar ou rebaixar sozinho. */
export async function atualizarUsuario(id: string, quemFaz: string, d: { nome?: string; papel?: string; ativo?: boolean; senha?: string }) {
  const u = await prisma.usuario.findUnique({ where: { id } });
  if (!u) return null;
  const perdeAdmin = u.papel === "ADMIN" && u.ativo && ((d.papel !== undefined && d.papel !== "ADMIN") || d.ativo === false);
  if (perdeAdmin) {
    if (id === quemFaz) throw new ErroEntrada("Você não pode se desativar nem rebaixar o próprio acesso");
    if ((await prisma.usuario.count({ where: { papel: "ADMIN", ativo: true, id: { not: id } } })) === 0) throw new ErroEntrada("O sistema precisa de ao menos um administrador ativo");
  }
  if (d.senha !== undefined && d.senha.length < SENHA_MINIMA) throw new ErroEntrada(`A senha precisa ter ao menos ${SENHA_MINIMA} caracteres`);
  invalidarCacheUsuario(id); // desativar vale na hora neste processo
  return prisma.usuario.update({
    where: { id }, select: publico,
    data: { ...(d.nome !== undefined && { nome: d.nome }), ...(d.papel !== undefined && { papel: d.papel }), ...(d.ativo !== undefined && { ativo: d.ativo }), ...(d.senha !== undefined && { senhaHash: await bcrypt.hash(d.senha, 10) }) },
  });
}
