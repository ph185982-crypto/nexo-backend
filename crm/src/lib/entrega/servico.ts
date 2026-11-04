import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { criarOportunidade } from "@/lib/funil/mover";
import { normalizarChecklist } from "@/lib/atividades/tarefas";
import { COLUNAS, PILARES, type Coluna } from "./constantes";
import { calcularSaudeEntrega } from "./saude";
import { depoisDeMoverCartao } from "./ciclo";

const num = (d: { toString(): string }) => Number(d.toString());

export async function listarEntregas(status?: string | null, agora: Date = new Date()) {
  const entregas = await prisma.entrega.findMany({
    where: status ? { status } : {}, orderBy: [{ renovacaoEm: { sort: "asc", nulls: "last" } }, { criadoEm: "desc" }], take: 200,
    include: { contato: { select: { id: true, nome: true } }, cartoes: { select: { coluna: true, dataAlvo: true, colunaDesdeEm: true } } },
  });
  return entregas.map((e) => ({
    id: e.id, nome: e.nome, status: e.status, contato: e.contato, inicioEm: e.inicioEm, renovacaoEm: e.renovacaoEm, valorMensal: num(e.valorMensal), oportunidadeId: e.oportunidadeId,
    saude: calcularSaudeEntrega(e.cartoes, e.renovacaoEm, agora),
  }));
}

export async function detalheEntrega(id: string, agora: Date = new Date()) {
  const e = await prisma.entrega.findUnique({
    where: { id },
    include: { contato: { select: { id: true, nome: true } }, cartoes: { orderBy: [{ coluna: "asc" }, { ordem: "asc" }], include: { responsavel: { select: { nome: true } } } }, modelo: { select: { nome: true } } },
  });
  if (!e) return null;
  return { ...e, valorMensal: num(e.valorMensal), saude: calcularSaudeEntrega(e.cartoes, e.renovacaoEm, agora) };
}

export interface NovoCartao { entregaId: string; titulo: string; descricao?: string | null; pilar?: string; coluna?: Coluna; dataAlvo?: Date | null; cliente?: boolean; responsavelId?: string | null; checklist?: unknown }

export async function criarCartao(n: NovoCartao) {
  const coluna = n.coluna ?? "BACKLOG";
  const ultimo = await prisma.entregaCartao.aggregate({ where: { entregaId: n.entregaId, coluna }, _max: { ordem: true } });
  return prisma.entregaCartao.create({
    data: {
      entregaId: n.entregaId, titulo: n.titulo, descricao: n.descricao ?? null, pilar: n.pilar ?? "COMERCIAL", coluna, ordem: (ultimo._max.ordem ?? -1) + 1,
      dataAlvo: n.dataAlvo ?? null, cliente: n.cliente ?? false, responsavelId: n.responsavelId ?? null,
      checklist: normalizarChecklist(n.checklist) as unknown as Prisma.InputJsonValue, concluidoEm: coluna === "CONCLUIDO" ? new Date() : null,
    },
  });
}

/**
 * Move o cartão para a coluna (na posição indicada, ou no fim) e renumera as duas colunas. Mudar de coluna marca o
 * cartão como planejado (a rotina não o move mais) e, depois de gravar, dispara "cartão concluído" e conclui ou
 * reabre a entrega.
 */
export async function moverCartao(cartaoId: string, coluna: Coluna, posicao?: number, agora: Date = new Date()) {
  if (!(COLUNAS as readonly string[]).includes(coluna)) throw new Error("Coluna inválida");
  const r = await prisma.$transaction(async (tx) => {
    const c = await tx.entregaCartao.findUnique({ where: { id: cartaoId } });
    if (!c) throw new Error("Cartão não encontrado");
    const destino = (await tx.entregaCartao.findMany({ where: { entregaId: c.entregaId, coluna, id: { not: c.id } }, orderBy: { ordem: "asc" }, select: { id: true } })).map((x) => x.id);
    const pos = posicao === undefined ? destino.length : Math.max(0, Math.min(posicao, destino.length));
    destino.splice(pos, 0, c.id);
    const mudouColuna = c.coluna !== coluna;
    await tx.entregaCartao.update({ where: { id: c.id }, data: { coluna, ...(mudouColuna && { colunaDesdeEm: agora, planejadoEm: agora, concluidoEm: coluna === "CONCLUIDO" ? agora : null }) } });
    for (const [i, id] of destino.entries()) await tx.entregaCartao.update({ where: { id }, data: { ordem: i } });
    if (mudouColuna) {
      const origem = await tx.entregaCartao.findMany({ where: { entregaId: c.entregaId, coluna: c.coluna }, orderBy: { ordem: "asc" }, select: { id: true } });
      for (const [i, o] of origem.entries()) await tx.entregaCartao.update({ where: { id: o.id }, data: { ordem: i } });
    }
    return { mudouColuna, de: c.coluna };
  });
  if (r.mudouColuna) await depoisDeMoverCartao(cartaoId, r.de, coluna, agora);
  return { mudouColuna: r.mudouColuna };
}

export const PILARES_VALIDOS = PILARES;

/** Nova oportunidade de upsell para o mesmo cliente, no funil padrão. */
export async function criarUpsell(entregaId: string, usuarioId: string) {
  const e = await prisma.entrega.findUnique({ where: { id: entregaId }, select: { nome: true, contatoId: true } });
  if (!e) throw new Error("Entrega não encontrada");
  return criarOportunidade({ nome: `Upsell — ${e.nome}`, contatoId: e.contatoId, responsavelId: usuarioId, origem: "Upsell", tags: ["upsell"], ator: usuarioId });
}
