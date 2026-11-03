import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ErroEntrada } from "@/lib/validar";

const NATUREZAS = ["ABERTA", "GANHA", "PERDIDA"] as const;
export type Natureza = (typeof NATUREZAS)[number];

const ETAPAS_INICIAIS: Array<{ nome: string; tipo: Natureza }> = [
  { nome: "Novo", tipo: "ABERTA" }, { nome: "Em andamento", tipo: "ABERTA" }, { nome: "Ganha", tipo: "GANHA" }, { nome: "Perdida", tipo: "PERDIDA" },
];

const duplicado = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function listarFunisConfig() {
  const funis = await prisma.funil.findMany({ orderBy: { ordem: "asc" }, include: { etapas: { orderBy: { ordem: "asc" } }, _count: { select: { oportunidades: true } } } });
  const porEtapa = await prisma.oportunidade.groupBy({ by: ["etapaId"], _count: { _all: true } });
  return funis.map((f) => ({
    id: f.id, nome: f.nome, ordem: f.ordem, padrao: f.padrao, ativo: f.ativo, oportunidades: f._count.oportunidades,
    etapas: f.etapas.map((e) => ({ id: e.id, nome: e.nome, tipo: e.tipo, ordem: e.ordem, descricao: e.descricao, oportunidades: porEtapa.find((x) => x.etapaId === e.id)?._count._all ?? 0 })),
  }));
}

export async function criarFunil(nome: string, padrao: boolean) {
  try {
    return await prisma.$transaction(async (tx) => {
      const ultimo = await tx.funil.aggregate({ _max: { ordem: true } });
      if (padrao) await tx.funil.updateMany({ where: { padrao: true }, data: { padrao: false } });
      const temPadrao = padrao || (await tx.funil.count({ where: { padrao: true } })) > 0;
      return tx.funil.create({ data: { nome, ordem: (ultimo._max.ordem ?? -1) + 1, padrao: padrao || !temPadrao, etapas: { create: ETAPAS_INICIAIS.map((e, ordem) => ({ ...e, ordem })) } } });
    });
  } catch (e) { if (duplicado(e)) throw new ErroEntrada("Já existe um funil com esse nome"); throw e; }
}

export async function atualizarFunil(id: string, d: { nome?: string; ativo?: boolean; padrao?: boolean; ordem?: number }) {
  const f = await prisma.funil.findUnique({ where: { id } });
  if (!f) return null;
  if (d.ativo === false && f.padrao && d.padrao !== false) throw new ErroEntrada("Este é o funil padrão. Escolha outro funil como padrão antes de desativar.");
  if (d.padrao === false && f.padrao) throw new ErroEntrada("Para trocar o funil padrão, marque o novo funil como padrão.");
  if (d.padrao === true && (d.ativo === false || (!f.ativo && d.ativo !== true))) throw new ErroEntrada("O funil padrão precisa estar ativo.");
  try {
    return await prisma.$transaction(async (tx) => {
      if (d.padrao === true) await tx.funil.updateMany({ where: { padrao: true, id: { not: id } }, data: { padrao: false } });
      return tx.funil.update({ where: { id }, data: { ...(d.nome !== undefined && { nome: d.nome }), ...(d.ativo !== undefined && { ativo: d.ativo }), ...(d.padrao !== undefined && { padrao: d.padrao }), ...(d.ordem !== undefined && { ordem: d.ordem }) } });
    });
  } catch (e) { if (duplicado(e)) throw new ErroEntrada("Já existe um funil com esse nome"); throw e; }
}

export async function excluirFunil(id: string): Promise<boolean> {
  const f = await prisma.funil.findUnique({ where: { id }, select: { padrao: true, _count: { select: { oportunidades: true } } } });
  if (!f) return false;
  if (f.padrao) throw new ErroEntrada("O funil padrão não pode ser excluído");
  if (f._count.oportunidades > 0) throw new ErroEntrada(`Há ${f._count.oportunidades} oportunidade(s) neste funil. Desative-o em vez de excluir.`);
  await prisma.funil.delete({ where: { id } });
  return true;
}

export async function criarEtapa(funilId: string, d: { nome: string; tipo: string; descricao: string | null }) {
  if (!(NATUREZAS as readonly string[]).includes(d.tipo)) throw new ErroEntrada("tipo inválido");
  if (!(await prisma.funil.findUnique({ where: { id: funilId }, select: { id: true } }))) return null;
  try {
    return await prisma.$transaction(async (tx) => {
      const todas = await tx.etapa.findMany({ where: { funilId }, orderBy: { ordem: "asc" }, select: { id: true, tipo: true } });
      const nova = await tx.etapa.create({ data: { funilId, nome: d.nome, tipo: d.tipo, descricao: d.descricao, ordem: todas.length } });
      // Etapa aberta entra antes de Ganha/Perdida: o funil lê do começo ao desfecho.
      const primeiraFinal = todas.findIndex((e) => e.tipo !== "ABERTA");
      if (d.tipo === "ABERTA" && primeiraFinal >= 0) {
        const ids = [...todas.slice(0, primeiraFinal).map((e) => e.id), nova.id, ...todas.slice(primeiraFinal).map((e) => e.id)];
        for (const [ordem, id] of ids.entries()) await tx.etapa.update({ where: { id }, data: { ordem } });
      }
      return nova;
    });
  } catch (e) { if (duplicado(e)) throw new ErroEntrada("Já existe uma etapa com esse nome neste funil"); throw e; }
}

export async function atualizarEtapa(id: string, d: { nome?: string; tipo?: string; descricao?: string | null }) {
  const e = await prisma.etapa.findUnique({ where: { id }, include: { _count: { select: { oportunidades: true } } } });
  if (!e) return null;
  if (d.tipo !== undefined && d.tipo !== e.tipo) {
    if (!(NATUREZAS as readonly string[]).includes(d.tipo)) throw new ErroEntrada("tipo inválido");
    // A natureza define status, motivo e entrega das oportunidades que já estão aqui: não muda com gente dentro.
    if (e._count.oportunidades > 0) throw new ErroEntrada(`Há ${e._count.oportunidades} oportunidade(s) nesta etapa. Mova-as antes de mudar a natureza.`);
    if (e.tipo === "ABERTA" && (await prisma.etapa.count({ where: { funilId: e.funilId, tipo: "ABERTA", id: { not: id } } })) === 0) throw new ErroEntrada("O funil precisa de ao menos uma etapa aberta");
  }
  try {
    return await prisma.etapa.update({ where: { id }, data: { ...(d.nome !== undefined && { nome: d.nome }), ...(d.tipo !== undefined && { tipo: d.tipo }), ...(d.descricao !== undefined && { descricao: d.descricao }) } });
  } catch (err) { if (duplicado(err)) throw new ErroEntrada("Já existe uma etapa com esse nome neste funil"); throw err; }
}

export async function excluirEtapa(id: string): Promise<boolean> {
  const e = await prisma.etapa.findUnique({ where: { id }, include: { _count: { select: { oportunidades: true } } } });
  if (!e) return false;
  if (e._count.oportunidades > 0) throw new ErroEntrada(`Há ${e._count.oportunidades} oportunidade(s) nesta etapa. Mova-as antes de excluir.`);
  if (e.tipo === "ABERTA" && (await prisma.etapa.count({ where: { funilId: e.funilId, tipo: "ABERTA", id: { not: id } } })) === 0) throw new ErroEntrada("O funil precisa de ao menos uma etapa aberta");
  await prisma.etapa.delete({ where: { id } });
  return true;
}

export async function reordenarEtapas(funilId: string, ids: string[]): Promise<boolean> {
  const atuais = await prisma.etapa.findMany({ where: { funilId }, select: { id: true } });
  if (atuais.length === 0 && !(await prisma.funil.findUnique({ where: { id: funilId }, select: { id: true } }))) return false;
  if (ids.length !== atuais.length || new Set(ids).size !== ids.length || !ids.every((i) => atuais.some((a) => a.id === i))) throw new ErroEntrada("A lista precisa conter exatamente as etapas do funil, sem repetir");
  await prisma.$transaction(ids.map((id, ordem) => prisma.etapa.update({ where: { id }, data: { ordem } })));
  return true;
}
