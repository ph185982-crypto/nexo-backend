// Edição dos dados de uma oportunidade (não da etapa: etapa e funil só em funil/mover.ts).
// Cada edição deixa uma linha "Editou a oportunidade" na linha do tempo, com o antes e o depois.
import { prisma } from "@/lib/prisma";
import { ErroEntrada, escolha, texto, textoOpc } from "@/lib/validar";
import { lerPrazo } from "@/lib/combinados/modelo";
import { moeda, PROBABILIDADE } from "@/lib/formatar";
import { numero } from "./produtos";

export const PROBABILIDADES = ["RISCO_ALTO", "FRIA", "MORNA", "QUENTE"] as const;

export interface EdicaoOportunidade {
  nome?: string;
  valorUnico?: number;
  valorMensal?: number;
  probabilidade?: string | null;
  origem?: string | null;
  tags?: string[];
  finalizaEm?: Date | null;
  responsavelId?: string | null;
  pessoaId?: string | null;
}

export function lerTags(v: unknown): string[] {
  const lista = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const limpas = lista.map((t) => String(t).trim().replace(/^#/, "").slice(0, 40)).filter(Boolean);
  return [...new Set(limpas)].slice(0, 20);
}

/** Só o que veio no corpo; o resto não muda. */
export function validarEdicaoOportunidade(c: Record<string, unknown>): EdicaoOportunidade {
  const o: EdicaoOportunidade = {};
  if (c.nome !== undefined) o.nome = texto(c.nome, "Nome", { min: 2, max: 200 });
  if (c.valorUnico !== undefined) o.valorUnico = numero(c.valorUnico, "Valor único");
  if (c.valorMensal !== undefined) o.valorMensal = numero(c.valorMensal, "Valor mensal");
  if (c.probabilidade !== undefined) o.probabilidade = c.probabilidade === null || c.probabilidade === "" ? null : escolha(c.probabilidade, "probabilidade", PROBABILIDADES);
  if (c.origem !== undefined) o.origem = textoOpc(c.origem, "Origem", 80);
  if (c.tags !== undefined) o.tags = lerTags(c.tags);
  if (c.finalizaEm !== undefined) o.finalizaEm = lerPrazo(c.finalizaEm);
  if (c.responsavelId !== undefined) o.responsavelId = c.responsavelId ? String(c.responsavelId) : null;
  if (c.pessoaId !== undefined) o.pessoaId = c.pessoaId ? String(c.pessoaId) : null;
  return o;
}

const dataBr = (d: Date | null) => (d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "sem data");
const num = (d: { toString(): string } | null) => (d ? Number(d.toString()) : 0);

export async function editarOportunidade(id: string, e: EdicaoOportunidade, ator: { id: string; nome: string | null }) {
  const op = await prisma.oportunidade.findUnique({
    where: { id },
    include: { responsavel: { select: { nome: true } }, pessoa: { select: { nome: true } }, _count: { select: { produtos: true } } },
  });
  if (!op) return null;
  if ((e.valorUnico !== undefined || e.valorMensal !== undefined) && op._count.produtos > 0) {
    throw new ErroEntrada("Os valores vêm dos produtos: edite os produtos da oportunidade");
  }
  const mudancas: string[] = [];
  const dados: Record<string, unknown> = {};
  const muda = (campo: keyof EdicaoOportunidade, igual: boolean, linha: string) => {
    if (e[campo] === undefined || igual) return;
    dados[campo] = e[campo];
    mudancas.push(linha);
  };

  muda("nome", e.nome === op.nome, `Nome: ${op.nome} → ${e.nome}`);
  muda("valorUnico", e.valorUnico === num(op.valorUnico), `Valor único: ${moeda(num(op.valorUnico))} → ${moeda(e.valorUnico ?? 0)}`);
  muda("valorMensal", e.valorMensal === num(op.valorMensal), `Valor mensal: ${moeda(num(op.valorMensal))} → ${moeda(e.valorMensal ?? 0)}`);
  muda("probabilidade", e.probabilidade === op.probabilidade, `Probabilidade: ${PROBABILIDADE[op.probabilidade ?? ""] ?? "—"} → ${PROBABILIDADE[e.probabilidade ?? ""] ?? "—"}`);
  muda("origem", e.origem === op.origem, `Origem: ${op.origem ?? "—"} → ${e.origem ?? "—"}`);
  muda("tags", JSON.stringify(e.tags) === JSON.stringify(op.tags), `Tags: ${op.tags.join(", ") || "—"} → ${e.tags?.join(", ") || "—"}`);
  const prorrogou = e.finalizaEm && op.finalizaEm && e.finalizaEm > op.finalizaEm;
  muda("finalizaEm", (e.finalizaEm?.getTime() ?? null) === (op.finalizaEm?.getTime() ?? null), `${prorrogou ? "Prorrogou" : "Data limite"}: ${dataBr(op.finalizaEm)} → ${dataBr(e.finalizaEm ?? null)}`);

  if (e.responsavelId !== undefined && e.responsavelId !== op.responsavelId) {
    const u = e.responsavelId ? await prisma.usuario.findFirst({ where: { id: e.responsavelId, ativo: true }, select: { nome: true } }) : null;
    if (e.responsavelId && !u) throw new ErroEntrada("Responsável não encontrado");
    dados.responsavelId = e.responsavelId;
    mudancas.push(`Responsável: ${op.responsavel?.nome ?? "—"} → ${u?.nome ?? "—"}`);
  }
  if (e.pessoaId !== undefined && e.pessoaId !== op.pessoaId) {
    const p = e.pessoaId ? await prisma.contato.findUnique({ where: { id: e.pessoaId }, select: { nome: true } }) : null;
    if (e.pessoaId && !p) throw new ErroEntrada("Contato relacionado não encontrado");
    dados.pessoaId = e.pessoaId;
    mudancas.push(`Contato relacionado: ${op.pessoa?.nome ?? "—"} → ${p?.nome ?? "—"}`);
  }
  if (!mudancas.length) return { mudancas };

  await prisma.$transaction([
    prisma.oportunidade.update({ where: { id }, data: dados }),
    prisma.feedback.create({ data: { oportunidadeId: id, tipo: "SISTEMA", texto: `Editou a oportunidade\n${mudancas.join("\n")}`, autor: ator.id, autorNome: ator.nome } }),
  ]);
  return { mudancas };
}

/** Dados da ficha que o cartão do kanban não traz: produtos, responsáveis possíveis, pessoas da empresa. */
export async function detalheOportunidade(id: string) {
  const op = await prisma.oportunidade.findUnique({ where: { id }, select: { id: true, contatoId: true, responsavelId: true, pessoaId: true, resumoIa: true, resumoIaEm: true } });
  if (!op) return null;
  const [usuarios, pessoas] = await Promise.all([
    prisma.usuario.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.contato.findMany({ where: { OR: [{ empresaId: op.contatoId }, { id: op.contatoId }, ...(op.pessoaId ? [{ id: op.pessoaId }] : [])] }, select: { id: true, nome: true, tipo: true }, orderBy: { nome: "asc" }, take: 100 }),
  ]);
  return { ...op, usuarios, pessoas };
}
