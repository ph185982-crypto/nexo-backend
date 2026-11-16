// O Comercial é de uma organização só (desenho D5). Onde o Vendedor IA exige organizationId (motivos de
// encerramento, eventos da agenda), usa-se esta: COMERCIAL_ORG_ID, se definida; senão a organização de
// vendas mais antiga. Guardada em memória por alguns minutos.
import { prisma } from "@/lib/prisma/client";

let cache: { id: string; ate: number } | null = null;

export async function organizacaoComercial(): Promise<string> {
  if (cache && cache.ate > Date.now()) return cache.id;
  const fixa = process.env.COMERCIAL_ORG_ID?.trim();
  const org = fixa
    ? await prisma.whatsappBusinessOrganization.findUnique({ where: { id: fixa }, select: { id: true } })
    : (await prisma.whatsappBusinessOrganization.findFirst({ where: { tipo: "VENDAS" }, orderBy: { createdAt: "asc" }, select: { id: true } }))
      ?? (await prisma.whatsappBusinessOrganization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }));
  if (!org) throw new Error("Nenhuma organização do Vendedor IA cadastrada");
  cache = { id: org.id, ate: Date.now() + 5 * 60_000 };
  return org.id;
}

/** Só para testes: esquece a organização guardada. */
export const esquecerOrganizacaoComercial = () => { cache = null; };
