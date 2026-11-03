import { prisma } from "@/lib/prisma";
import { INTENCOES, PESO_INTENCAO, type Intencao } from "./intencoes";

export interface NovoFeedback {
  oportunidadeId?: string | null;
  contatoId?: string | null;
  tipo: string;
  texto: string;
  intencao?: Intencao | null;
  importante?: boolean;
  autor?: string | null;
  autorNome?: string | null;
}

export async function registrarFeedback(n: NovoFeedback) {
  let contatoId = n.contatoId ?? null;
  if (n.oportunidadeId && !contatoId) {
    contatoId = (await prisma.oportunidade.findUnique({ where: { id: n.oportunidadeId }, select: { contatoId: true } }))?.contatoId ?? null;
  }
  const f = await prisma.feedback.create({
    data: { oportunidadeId: n.oportunidadeId ?? null, contatoId, tipo: n.tipo, texto: n.texto, intencao: n.intencao ?? null, importante: n.importante ?? false, autor: n.autor ?? null, autorNome: n.autorNome ?? null },
  });
  // Interação = atividade: zera o "sem atividade" da oportunidade.
  if (n.oportunidadeId && n.tipo !== "SISTEMA") {
    await prisma.oportunidade.update({ where: { id: n.oportunidadeId }, data: { ultimaAtividadeEm: f.criadoEm } });
  }
  return f;
}

/**
 * Saúde do negócio, 0–100: parte de 50 e soma o peso dos sinais de intenção dos últimos 30 dias,
 * menos 1 ponto por dia parado além de 7. Rótulo: ≥70 quente, ≥45 morna, ≥25 fria, senão risco alto.
 */
export function calcularSaude(intencoes: Array<string | null>, diasSemAtividade: number): { nota: number; rotulo: "QUENTE" | "MORNA" | "FRIA" | "RISCO_ALTO" } {
  let nota = 50;
  for (const i of intencoes) if (i && (INTENCOES as readonly string[]).includes(i)) nota += PESO_INTENCAO[i as Intencao];
  nota -= Math.max(0, diasSemAtividade - 7);
  nota = Math.max(0, Math.min(100, nota));
  return { nota, rotulo: nota >= 70 ? "QUENTE" : nota >= 45 ? "MORNA" : nota >= 25 ? "FRIA" : "RISCO_ALTO" };
}
