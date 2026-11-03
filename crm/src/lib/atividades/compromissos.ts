import { prisma } from "@/lib/prisma";

export const TIPOS_COMPROMISSO = ["REUNIAO", "LIGACAO", "VISITA", "OUTRO"] as const;

export async function criarCompromisso(n: {
  assunto: string; tipo?: string; inicio: Date; fim: Date; local?: string | null; descricao?: string | null; participantes?: string[];
  responsavelId?: string | null; contatoId?: string | null; oportunidadeId?: string | null; origem?: "MANUAL" | "INTEGRACAO";
}) {
  if (n.fim <= n.inicio) throw new Error("O fim precisa ser depois do início");
  let contatoId = n.contatoId ?? null;
  if (!contatoId && n.oportunidadeId) contatoId = (await prisma.oportunidade.findUnique({ where: { id: n.oportunidadeId }, select: { contatoId: true } }))?.contatoId ?? null;
  return prisma.compromisso.create({
    data: { assunto: n.assunto, tipo: n.tipo ?? "REUNIAO", inicio: n.inicio, fim: n.fim, local: n.local ?? null, descricao: n.descricao ?? null, participantes: n.participantes ?? [], responsavelId: n.responsavelId ?? null, contatoId, oportunidadeId: n.oportunidadeId ?? null, origem: n.origem ?? "MANUAL" },
  });
}

export async function listarCompromissos(de: Date, ate: Date, responsavelId?: string | null) {
  return prisma.compromisso.findMany({
    where: { inicio: { gte: de, lt: ate }, status: { not: "CANCELADO" }, ...(responsavelId ? { responsavelId } : {}) },
    orderBy: { inicio: "asc" }, take: 500,
    include: { contato: { select: { id: true, nome: true } }, oportunidade: { select: { id: true, nome: true } }, responsavel: { select: { nome: true } } },
  });
}
