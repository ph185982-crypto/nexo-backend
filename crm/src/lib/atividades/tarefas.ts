import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { limitesDoDia, somarRecorrencia } from "./tempo";

import { PRIORIDADES, RECORRENCIAS, TIPOS_TAREFA, VISOES, type Visao } from "./constantes";
export { PRIORIDADES, RECORRENCIAS, TIPOS_TAREFA, VISOES };
export type { Visao };

export interface ItemChecklist { texto: string; feito: boolean }

export function normalizarChecklist(v: unknown): ItemChecklist[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 50).flatMap((i) => {
    const t = typeof i?.texto === "string" ? i.texto.trim().slice(0, 200) : "";
    return t ? [{ texto: t, feito: i.feito === true }] : [];
  });
}

export interface NovaTarefa {
  titulo: string;
  descricao?: string | null;
  tipo?: string;
  prioridade?: string;
  prazoEm?: Date | null;
  recorrencia?: string | null;
  checklist?: ItemChecklist[];
  responsavelId?: string | null;
  contatoId?: string | null;
  oportunidadeId?: string | null;
  paiId?: string | null;
  origem?: "MANUAL" | "AUTOMACAO" | "INTEGRACAO";
}

export async function criarTarefa(n: NovaTarefa, db: Prisma.TransactionClient | typeof prisma = prisma) {
  // Tarefa de uma oportunidade herda o contato dela.
  let contatoId = n.contatoId ?? null;
  if (!contatoId && n.oportunidadeId) {
    contatoId = (await db.oportunidade.findUnique({ where: { id: n.oportunidadeId }, select: { contatoId: true } }))?.contatoId ?? null;
  }
  return db.tarefa.create({
    data: {
      titulo: n.titulo, descricao: n.descricao ?? null, tipo: n.tipo ?? "TAREFA", prioridade: n.prioridade ?? "NORMAL",
      prazoEm: n.prazoEm ?? null, recorrencia: n.recorrencia ?? null, checklist: (n.checklist ?? []) as unknown as Prisma.InputJsonValue,
      responsavelId: n.responsavelId ?? null, contatoId, oportunidadeId: n.oportunidadeId ?? null, paiId: n.paiId ?? null, origem: n.origem ?? "MANUAL",
    },
  });
}

/** Conclui a tarefa. Recorrente: cria a próxima com o prazo somado e o checklist zerado. */
export async function concluirTarefa(id: string, agora: Date = new Date()) {
  return prisma.$transaction(async (tx) => {
    const t = await tx.tarefa.findUnique({ where: { id } });
    if (!t) throw new Error("Tarefa não encontrada");
    if (t.status === "CONCLUIDA") return { tarefa: t, proxima: null };
    const feita = await tx.tarefa.update({ where: { id }, data: { status: "CONCLUIDA", concluidaEm: agora } });
    // Tarefa de um combinado: concluí-la cumpre o combinado.
    await tx.combinado.updateMany({ where: { tarefaId: id, status: "PENDENTE" }, data: { status: "ENTREGUE", entregueEm: agora } });
    if (t.oportunidadeId) await tx.oportunidade.update({ where: { id: t.oportunidadeId }, data: { ultimaAtividadeEm: agora } });
    let proxima = null;
    if (t.recorrencia && !t.paiId) {
      const base = t.prazoEm ?? agora;
      let prazo = somarRecorrencia(base, t.recorrencia);
      while (prazo <= agora) prazo = somarRecorrencia(prazo, t.recorrencia); // não cria tarefa já vencida
      const zerado = normalizarChecklist(t.checklist).map((i) => ({ ...i, feito: false }));
      proxima = await criarTarefa({ titulo: t.titulo, descricao: t.descricao, tipo: t.tipo, prioridade: t.prioridade, prazoEm: prazo, recorrencia: t.recorrencia, checklist: zerado, responsavelId: t.responsavelId, contatoId: t.contatoId, oportunidadeId: t.oportunidadeId, origem: t.origem as "MANUAL" }, tx);
    }
    return { tarefa: feita, proxima };
  });
}

function filtroDaVisao(visao: Visao, agora: Date): Prisma.TarefaWhereInput {
  const { inicio, fim } = limitesDoDia(agora);
  switch (visao) {
    case "hoje": return { status: "ABERTA", prazoEm: { gte: inicio, lt: fim } };
    case "atrasadas": return { status: "ABERTA", prazoEm: { lt: inicio } };
    case "proximos7": return { status: "ABERTA", prazoEm: { gte: inicio, lt: new Date(inicio.getTime() + 7 * 86_400_000) } };
    case "concluidas": return { status: "CONCLUIDA" };
    default: return { status: "ABERTA" };
  }
}

export async function listarTarefas(o: { visao: Visao; responsavelId?: string | null; oportunidadeId?: string | null; contatoId?: string | null; agora?: Date }) {
  const agora = o.agora ?? new Date();
  const where: Prisma.TarefaWhereInput = {
    ...filtroDaVisao(o.visao, agora), paiId: null,
    ...(o.responsavelId ? { responsavelId: o.responsavelId } : {}),
    ...(o.oportunidadeId ? { oportunidadeId: o.oportunidadeId } : {}),
    ...(o.contatoId ? { contatoId: o.contatoId } : {}),
  };
  return prisma.tarefa.findMany({
    where,
    orderBy: o.visao === "concluidas" ? { concluidaEm: "desc" } : [{ prazoEm: { sort: "asc", nulls: "last" } }, { criadoEm: "asc" }],
    take: 200,
    include: { contato: { select: { id: true, nome: true } }, oportunidade: { select: { id: true, nome: true } }, responsavel: { select: { nome: true } }, subtarefas: { orderBy: { criadoEm: "asc" } } },
  });
}

export async function contarVisoes(responsavelId?: string | null, agora: Date = new Date()): Promise<Record<Visao, number>> {
  const base = responsavelId ? { responsavelId } : {};
  const entradas = await Promise.all(VISOES.map(async (v) => [v, await prisma.tarefa.count({ where: { ...filtroDaVisao(v, agora), paiId: null, ...base } })] as const));
  return Object.fromEntries(entradas) as Record<Visao, number>;
}
