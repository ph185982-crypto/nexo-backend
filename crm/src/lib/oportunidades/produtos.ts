// Produtos: catálogo e linhas da oportunidade. Com linhas, os valores da oportunidade são a soma delas
// (único e mensal); sem linhas, continuam editáveis à mão.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ErroEntrada, escolha, texto, textoOpc } from "@/lib/validar";

type Db = Prisma.TransactionClient | typeof prisma;

export const RECORRENCIAS = ["UNICO", "MENSAL"] as const;
export type Recorrencia = (typeof RECORRENCIAS)[number];
export const ROTULO_RECORRENCIA: Record<Recorrencia, string> = { UNICO: "Único", MENSAL: "Mensal" };

const num = (d: { toString(): string } | number | null | undefined) => (d == null ? 0 : Number(d.toString()));
const redondo = (v: number) => Math.round(v * 100) / 100;

export function numero(v: unknown, campo: string, { min = 0, max = 1e12 }: { min?: number; max?: number } = {}): number {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < min || n > max) throw new ErroEntrada(`${campo} inválido`);
  return redondo(n);
}

/** Valor de uma linha: quantidade × valor unitário, menos o desconto (%). */
export function valorDaLinha(l: { quantidade: unknown; valorUnitario: unknown; desconto: unknown }): number {
  return redondo(num(l.quantidade as number) * num(l.valorUnitario as number) * (1 - num(l.desconto as number) / 100));
}

/** Soma das linhas por recorrência. */
export function totaisDasLinhas(linhas: Array<{ quantidade: unknown; valorUnitario: unknown; desconto: unknown; recorrencia: string }>) {
  let unico = 0, mensal = 0;
  for (const l of linhas) (l.recorrencia === "MENSAL" ? (mensal += valorDaLinha(l)) : (unico += valorDaLinha(l)));
  return { valorUnico: redondo(unico), valorMensal: redondo(mensal) };
}

/** Grava na oportunidade a soma das linhas (sem linhas, não mexe: valores manuais continuam). */
export async function recalcularValores(oportunidadeId: string, db: Db = prisma) {
  const linhas = await db.oportunidadeProduto.findMany({ where: { oportunidadeId } });
  if (!linhas.length) return null;
  const t = totaisDasLinhas(linhas);
  await db.oportunidade.update({ where: { id: oportunidadeId }, data: t });
  return t;
}

// ── Catálogo ────────────────────────────────────────────────────────────────
export interface DadosProduto { nome: string; codigo: string | null; descricao: string | null; valor: number; recorrencia: Recorrencia; ativo: boolean }

export function validarProduto(c: Record<string, unknown>, parcial = false): Partial<DadosProduto> {
  const o: Partial<DadosProduto> = {};
  if (!parcial || c.nome !== undefined) o.nome = texto(c.nome, "Nome", { min: 2, max: 120 });
  if (!parcial || c.codigo !== undefined) o.codigo = textoOpc(c.codigo, "Código", 40);
  if (!parcial || c.descricao !== undefined) o.descricao = textoOpc(c.descricao, "Descrição", 1000);
  if (!parcial || c.valor !== undefined) o.valor = numero(c.valor ?? 0, "Valor");
  if (!parcial || c.recorrencia !== undefined) o.recorrencia = escolha(c.recorrencia, "recorrência", RECORRENCIAS, "UNICO");
  if (c.ativo !== undefined) o.ativo = c.ativo === true;
  return o;
}

export const listarProdutos = (todos = false) =>
  prisma.produto.findMany({ where: todos ? {} : { ativo: true }, orderBy: [{ ativo: "desc" }, { nome: "asc" }] });

// ── Linhas da oportunidade ──────────────────────────────────────────────────
export interface DadosLinha { produtoId: string | null; nome: string; quantidade: number; valorUnitario: number; desconto: number; recorrencia: Recorrencia }

/** Do catálogo (produtoId) vêm nome, valor e recorrência, que o corpo pode sobrescrever. */
export async function validarLinha(c: Record<string, unknown>, parcial = false): Promise<Partial<DadosLinha>> {
  const o: Partial<DadosLinha> = {};
  if (!parcial && c.produtoId) {
    const p = await prisma.produto.findUnique({ where: { id: String(c.produtoId) } });
    if (!p) throw new ErroEntrada("Produto não encontrado");
    Object.assign(o, { produtoId: p.id, nome: p.nome, valorUnitario: num(p.valor), recorrencia: p.recorrencia as Recorrencia });
  }
  if (c.nome !== undefined || (!parcial && !o.nome)) o.nome = texto(c.nome, "Nome do produto", { min: 2, max: 120 });
  if (c.quantidade !== undefined || !parcial) o.quantidade = numero(c.quantidade ?? 1, "Quantidade", { min: 0.01, max: 1e6 });
  if (c.valorUnitario !== undefined || (!parcial && o.valorUnitario === undefined)) o.valorUnitario = numero(c.valorUnitario, "Valor unitário");
  if (c.desconto !== undefined || !parcial) o.desconto = numero(c.desconto ?? 0, "Desconto", { max: 100 });
  if (c.recorrencia !== undefined || (!parcial && !o.recorrencia)) o.recorrencia = escolha(c.recorrencia, "recorrência", RECORRENCIAS, "UNICO");
  return o;
}

export async function adicionarLinha(oportunidadeId: string, d: Partial<DadosLinha>) {
  return prisma.$transaction(async (tx) => {
    const l = await tx.oportunidadeProduto.create({
      data: { oportunidadeId, produtoId: d.produtoId ?? null, nome: d.nome!, quantidade: d.quantidade ?? 1, valorUnitario: d.valorUnitario ?? 0, desconto: d.desconto ?? 0, recorrencia: d.recorrencia ?? "UNICO" },
    });
    await recalcularValores(oportunidadeId, tx);
    return l;
  });
}

export async function editarLinha(oportunidadeId: string, linhaId: string, d: Partial<DadosLinha>) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.oportunidadeProduto.updateMany({ where: { id: linhaId, oportunidadeId }, data: d });
    if (!r.count) return false;
    await recalcularValores(oportunidadeId, tx);
    return true;
  });
}

/** Tirar a última linha zera os valores (o que estava lá vinha dos produtos). */
export async function removerLinha(oportunidadeId: string, linhaId: string) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.oportunidadeProduto.deleteMany({ where: { id: linhaId, oportunidadeId } });
    if (!r.count) return false;
    if (!(await recalcularValores(oportunidadeId, tx))) await tx.oportunidade.update({ where: { id: oportunidadeId }, data: { valorUnico: 0, valorMensal: 0 } });
    return true;
  });
}

export async function linhasDaOportunidade(oportunidadeId: string) {
  const linhas = await prisma.oportunidadeProduto.findMany({ where: { oportunidadeId }, orderBy: { criadoEm: "asc" } });
  return linhas.map((l) => ({
    id: l.id, produtoId: l.produtoId, nome: l.nome, quantidade: num(l.quantidade), valorUnitario: num(l.valorUnitario),
    desconto: num(l.desconto), recorrencia: l.recorrencia, total: valorDaLinha(l),
  }));
}
