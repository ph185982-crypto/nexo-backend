// Login único (Avanteza ID): do token já verificado ao usuário local do CRM.
// A sessão continua sendo a do próprio CRM (cookie assinado com SESSION_SECRET) — a Central só diz quem é a pessoa.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { IdentidadeAvanteza } from "@/lib/avanteza-sso";

/** Identificador deste aplicativo na Central (o `aud` do token). */
export const APP_SSO = "crm";

export type ResultadoSso =
  | { ok: true; usuario: { id: string; nome: string }; criado: boolean }
  | { ok: false; motivo: "DESATIVADO" };

const porEmail = (email: string) => prisma.usuario.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

/**
 * Acha o usuário pelo e-mail (sem diferenciar maiúsculas) ou cria um na primeira entrada.
 * - Novo: ADMIN só se a Central disser `admin`; qualquer outro papel entra como VENDEDOR (o mais restrito do CRM).
 *   A senha é aleatória, só o hash é guardado e ela nunca é mostrada: a pessoa entra pela Central.
 * - Existente: o papel local NÃO muda (quem manda no papel dentro do CRM é Configuração → Usuários).
 * - Desativado: recusado, como no login por senha.
 */
export async function usuarioDoSso(identidade: Pick<IdentidadeAvanteza, "email" | "name" | "role">): Promise<ResultadoSso> {
  const email = identidade.email.trim().toLowerCase();
  let usuario = await porEmail(email);
  let criado = false;
  if (!usuario) {
    const senhaHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 10);
    const nome = identidade.name.trim().slice(0, 120) || email.split("@")[0];
    try {
      usuario = await prisma.usuario.create({ data: { nome, email, senhaHash, papel: identidade.role === "admin" ? "ADMIN" : "VENDEDOR" } });
      criado = true;
    } catch (e) {
      // Duas entradas ao mesmo tempo: a outra criou primeiro; usa o que ficou.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      usuario = await porEmail(email);
      if (!usuario) throw e;
    }
  }
  if (!usuario.ativo) return { ok: false, motivo: "DESATIVADO" };
  return { ok: true, usuario: { id: usuario.id, nome: usuario.nome }, criado };
}
