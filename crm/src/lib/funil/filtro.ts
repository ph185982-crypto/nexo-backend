// Filtros do kanban e exportação, sem banco: rodam na tela sobre o quadro já carregado.
import type { CartaoDTO, EtapaDTO, QuadroDTO } from "./quadro";
import { diasDesde } from "./encerramento";
import { PARADO_CRITICO_DIAS, PROBABILIDADE } from "@/lib/formatar";

export const SITUACOES = { "": "Todas", SEM_PROXIMA: "Sem próxima atividade", ATRASADA: "Passou da data limite", PARADA: `Paradas (${PARADO_CRITICO_DIAS}+ dias)` } as const;
export type Situacao = keyof typeof SITUACOES;

export interface Filtros { q: string; responsavel: string; probabilidade: string; tag: string; situacao: Situacao }
export const SEM_FILTRO: Filtros = { q: "", responsavel: "", probabilidade: "", tag: "", situacao: "" };
export const temFiltro = (f: Filtros) => Object.values(f).some(Boolean);

const semAcento = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function passa(c: CartaoDTO, f: Filtros, agora = new Date()): boolean {
  if (f.q) {
    const alvo = semAcento([c.nome, c.codigo, c.contato.nome, c.pessoa?.nome, c.origem, ...c.tags].filter(Boolean).join(" "));
    if (!semAcento(f.q).split(/\s+/).filter(Boolean).every((p) => alvo.includes(p))) return false;
  }
  if (f.responsavel && (c.responsavel ?? "—") !== f.responsavel) return false;
  if (f.probabilidade && (c.probabilidade ?? "—") !== f.probabilidade) return false;
  if (f.tag && !c.tags.includes(f.tag)) return false;
  const aberta = c.status === "EM_ANDAMENTO";
  if (f.situacao === "SEM_PROXIMA" && !(aberta && !c.proximaAtividade)) return false;
  if (f.situacao === "ATRASADA" && !(aberta && c.finalizaEm && new Date(c.finalizaEm) < agora)) return false;
  if (f.situacao === "PARADA" && !(aberta && diasDesde(c.ultimaAtividadeEm, agora) >= PARADO_CRITICO_DIAS)) return false;
  return true;
}

export function filtrarQuadro(q: QuadroDTO, f: Filtros, agora = new Date()): QuadroDTO {
  if (!temFiltro(f)) return q;
  const etapa = (e: EtapaDTO): EtapaDTO => {
    const oportunidades = e.oportunidades.filter((c) => passa(c, f, agora));
    return { ...e, oportunidades, quantidade: oportunidades.length, total: oportunidades.reduce((s, c) => s + c.valorTotal, 0) };
  };
  return { ...q, etapas: q.etapas.map(etapa), finalizadas: { ...q.finalizadas, etapas: q.finalizadas.etapas.map(etapa) } };
}

/** Opções dos filtros a partir do que está no quadro. */
export function opcoesDoQuadro(q: QuadroDTO) {
  const cartoes = [...q.etapas, ...q.finalizadas.etapas].flatMap((e) => e.oportunidades);
  const unicos = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return { responsaveis: unicos(cartoes.map((c) => c.responsavel ?? "—")), tags: unicos(cartoes.flatMap((c) => c.tags)) };
}

const celula = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  const seguro = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // evita fórmula ao abrir no Excel
  return /[";\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};
const br = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
const valor = (n: number) => n.toFixed(2).replace(".", ",");

/** CSV com ";" (abre direto no Excel em português). */
export function csvOportunidades(q: QuadroDTO, agora = new Date()): string {
  const cab = ["Código", "Oportunidade", "Empresa", "Contato", "Etapa", "Situação", "Responsável", "Valor único", "Valor mensal", "Total", "Probabilidade", "Origem", "Tags", "Criada em", "Finaliza em", "Dias na etapa", "Dias sem atividade", "Motivo"];
  const linhas = [...q.etapas, ...q.finalizadas.etapas].flatMap((e) => e.oportunidades.map((c) => [
    c.codigo, c.nome, c.contato.nome, c.pessoa?.nome, e.nome, c.status === "EM_ANDAMENTO" ? "Em andamento" : c.status === "GANHA" ? "Ganha" : "Perdida",
    c.responsavel, valor(c.valorUnico), valor(c.valorMensal), valor(c.valorTotal), PROBABILIDADE[c.probabilidade ?? ""] ?? "", c.origem, c.tags.join(", "),
    br(c.criadoEm), br(c.finalizaEm), diasDesde(c.etapaDesdeEm, agora), diasDesde(c.ultimaAtividadeEm, agora), c.motivo,
  ]));
  return "﻿" + [cab, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n");
}
