// Login único (Avanteza ID): do token da Central ao usuário local do Vendedor IA.
// A sessão continua sendo a do NextAuth (a mesma do login por senha) — a Central só diz quem é a pessoa.
// Só roda no Node (Prisma, bcrypt, node:crypto): não importar no middleware nem em lib/auth/config.ts.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import { verifyAvantezaToken, type IdentidadeAvanteza } from "@/lib/avanteza-sso";

/** Identificador deste aplicativo na Central (o `aud` do token). */
export const APP_SSO = "vendas";
/** Id do provider do NextAuth que recebe o token (o de senha continua sendo "credentials"). */
export const PROVIDER_SSO = "avanteza-sso";

export interface UsuarioSessao { id: string; name: string | null; email: string | null; role: string }

const porEmail = (email: string) => prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

/**
 * Acha o usuário pelo e-mail (sem diferenciar maiúsculas) ou cria um na primeira entrada.
 * - Novo: ADMIN só se a Central disser `admin`; qualquer outro papel entra como SELLER (o mais restrito daqui).
 *   A senha é aleatória, só o hash é guardado e ela nunca é mostrada: a pessoa entra pela Central.
 * - Existente: o papel local NÃO muda.
 * O modelo User deste app não tem campo de "desativado"; quando tiver, a recusa entra aqui.
 */
export async function usuarioDoSso(identidade: Pick<IdentidadeAvanteza, "email" | "name" | "role">): Promise<{ usuario: UsuarioSessao; criado: boolean }> {
  const email = identidade.email.trim().toLowerCase();
  let user = await porEmail(email);
  let criado = false;
  if (!user) {
    const password = await bcrypt.hash(randomBytes(32).toString("base64url"), 10);
    const name = identidade.name.trim().slice(0, 120) || email.split("@")[0];
    try {
      user = await prisma.user.create({ data: { name, email, password, role: identidade.role === "admin" ? "ADMIN" : "SELLER" } });
      criado = true;
    } catch (e) {
      // Duas entradas ao mesmo tempo: a outra criou primeiro; usa o que ficou.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      user = await porEmail(email);
      if (!user) throw e;
    }
  }
  return { usuario: { id: user.id, name: user.name, email: user.email, role: user.role }, criado };
}

/**
 * `authorize` do provider "avanteza-sso": confere o token (assinatura, emissor, aud = vendas, validade) e devolve
 * o usuário da sessão, ou null se algo não bater. É aqui que a verificação vale de verdade — a rota de volta
 * também confere, mas só para saber o caminho de retorno.
 */
export async function autorizarSso(token: unknown): Promise<UsuarioSessao | null> {
  try {
    const identidade = await verifyAvantezaToken(typeof token === "string" ? token : null, { audience: APP_SSO });
    return (await usuarioDoSso(identidade)).usuario;
  } catch (e) {
    console.warn(`[Auth] Login único recusado: ${e instanceof Error ? e.message : "erro"}`);
    return null;
  }
}
