// Chaves de serviço para sistemas que chamam o CRM (hoje: Vendedor IA).
// A chave inteira só aparece uma vez, na criação; o banco guarda só o hash.
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

const PREFIXO = "avz_live_";
export const hashChave = (chave: string) => createHash("sha256").update(chave).digest("hex");

export function gerarChave() {
  const chave = PREFIXO + randomBytes(24).toString("hex");
  return { chave, prefixo: chave.slice(0, PREFIXO.length + 6), hash: hashChave(chave) };
}

/** Valida `Authorization: Bearer avz_live_…`. Devolve a chave ou null. */
export async function validarChave(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(avz_live_[a-f0-9]{48})$/.exec(h.trim());
  if (!m) return null;
  const registro = await prisma.chaveIntegracao.findUnique({ where: { hash: hashChave(m[1]) } });
  if (!registro || registro.revogadaEm) return null;
  await prisma.chaveIntegracao.update({ where: { id: registro.id }, data: { ultimoUsoEm: new Date() } }).catch(() => {});
  return registro;
}
