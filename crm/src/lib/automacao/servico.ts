import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ErroEntrada } from "@/lib/validar";
import { MAX_AUTOMACOES_ATIVAS, validarAutomacao, type AutomacaoValidada } from "./modelo";

/** Regras que dependem do banco: etapa de destino existe; limite de automações ativas. */
export async function conferirComBanco(a: AutomacaoValidada, ignorarId?: string): Promise<void> {
  for (const ac of a.acoes) {
    if (ac.tipo === "MOVER_ETAPA" && !(await prisma.etapa.findUnique({ where: { id: ac.etapaId }, select: { id: true } }))) throw new ErroEntrada("Etapa de destino não encontrada");
  }
  for (const c of a.criterios) {
    if (c.campo === "etapaId" && !(await prisma.etapa.findUnique({ where: { id: String(c.valor) }, select: { id: true } }))) throw new ErroEntrada("Etapa do critério não encontrada");
    if (c.campo === "funilId" && !(await prisma.funil.findUnique({ where: { id: String(c.valor) }, select: { id: true } }))) throw new ErroEntrada("Funil do critério não encontrado");
  }
  if (a.ativo) {
    const ativas = await prisma.automacao.count({ where: { ativo: true, ...(ignorarId ? { id: { not: ignorarId } } : {}) } });
    if (ativas >= MAX_AUTOMACOES_ATIVAS) throw new ErroEntrada(`Limite de ${MAX_AUTOMACOES_ATIVAS} automações ativas`);
  }
}

export async function criarAutomacao(corpo: unknown, usuarioId: string) {
  const a = validarAutomacao(corpo);
  await conferirComBanco(a);
  return prisma.automacao.create({ data: { nome: a.nome, descricao: a.descricao, ativo: a.ativo, gatilho: a.gatilho, criterios: a.criterios as unknown as Prisma.InputJsonValue, acoes: a.acoes as unknown as Prisma.InputJsonValue, criadaPorId: usuarioId } });
}

export async function atualizarAutomacao(id: string, corpo: Record<string, unknown>) {
  const atual = await prisma.automacao.findUnique({ where: { id } });
  if (!atual) return null;
  // Mescla com o que já existe e valida o conjunto inteiro (um PATCH de "ativo" não pode deixar a automação inválida).
  const a = validarAutomacao({ nome: atual.nome, descricao: atual.descricao, ativo: atual.ativo, gatilho: atual.gatilho, criterios: atual.criterios, acoes: atual.acoes, ...corpo });
  await conferirComBanco(a, id);
  return prisma.automacao.update({ where: { id }, data: { nome: a.nome, descricao: a.descricao, ativo: a.ativo, gatilho: a.gatilho, criterios: a.criterios as unknown as Prisma.InputJsonValue, acoes: a.acoes as unknown as Prisma.InputJsonValue } });
}

export async function listarAutomacoes() {
  const lista = await prisma.automacao.findMany({ orderBy: [{ ativo: "desc" }, { criadoEm: "desc" }], take: 300 });
  const contagem = await prisma.automacaoExecucao.groupBy({ by: ["automacaoId", "status"], _count: { _all: true } });
  return lista.map((a) => {
    const c = contagem.filter((x) => x.automacaoId === a.id);
    const n = (s: string) => c.find((x) => x.status === s)?._count._all ?? 0;
    return { ...a, execucoes: { executadas: n("EXECUTADA"), pendentes: n("PENDENTE") + n("EXECUTANDO"), ignoradas: n("IGNORADA"), erros: n("ERRO") } };
  });
}
