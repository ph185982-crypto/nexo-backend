// Configuração ÚNICA do mapeamento funil → colunas do Kanban e → eventos da Meta.
//
// As organizações têm dois layouts de colunas no banco: o canônico (6 colunas por
// tipo: TRIAGE, EM_QUALIFICACAO, PROPOSTA_NEGOCIACAO, CONTRATO, GANHO, LOST) e o
// legado do /api/sdr/setup, onde "Em qualificação" e "Qualificados" são do tipo
// CUSTOM — a busca só por tipo nunca as achava e os leads ficavam parados em
// "Novos". Por isso cada alvo aceita tipos E nomes. Para mudar o comportamento,
// edite só este arquivo.

/** Faturamento mensal mínimo (R$) para o lead contar como qualificado. */
export const FATURAMENTO_MINIMO_MENSAL = 40_000;

/** Normaliza nome de coluna: sem acento, minúsculo, sem espaços nas pontas. */
export function normalizarNome(nome: string): string {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

export interface AlvoColuna {
  /** Tipos de coluna aceitos (KanbanColumn.type), em ordem de preferência. */
  tipos: string[];
  /** Nomes aceitos (comparados sem acento/caixa) — para colunas CUSTOM. */
  nomes: string[];
}

/**
 * Para onde cada destino do funil aponta. A busca tenta, nesta ordem: o tipo
 * pedido, os tipos abaixo, depois os nomes. Só cai nos nomes quando nenhum tipo
 * existe, então orgs com o layout canônico se comportam como antes.
 */
export const ALVOS_COLUNA: Record<string, AlvoColuna> = {
  EM_QUALIFICACAO: { tipos: ["EM_QUALIFICACAO"], nomes: ["em qualificacao", "qualificacao"] },
  MORNO:           { tipos: ["MORNO"], nomes: ["mornos", "mornos (nutricao)", "morno"] },
  QUALIFICADO:     { tipos: ["QUALIFICADO", "PROPOSTA_NEGOCIACAO"], nomes: ["qualificados", "qualificado"] },
  PROPOSTA_NEGOCIACAO: { tipos: ["PROPOSTA_NEGOCIACAO", "QUALIFICADO"], nomes: ["qualificados", "qualificado", "proposta e negociacao"] },
};

/**
 * Colunas que disparam o evento LeadSubmitted: "Qualificados" (layout legado,
 * coluna CUSTOM) ou a canônica equivalente (PROPOSTA_NEGOCIACAO). Propositalmente
 * NÃO inclui Proposta / Reunião / Contrato: outros agentes movem leads para lá sem
 * checar o ICP, e o evento deve significar "bateu loja física + faturamento + CNPJ".
 * Se quiser que etapas seguintes também avisem a Meta, acrescente os tipos aqui.
 */
export const COLUNAS_QUALIFICADO = {
  tipos: ["QUALIFICADO", "PROPOSTA_NEGOCIACAO"],
  nomes: ["qualificados", "qualificado"],
};

/** Só para o painel de anúncios: etapas que implicam lead já qualificado. */
const TIPOS_ALEM_DE_QUALIFICADO = ["PROPOSTA", "REUNIAO_AGENDADA", "CONTRATO"];

/** Colunas que contam como venda fechada (evento Purchase). */
export const COLUNAS_GANHO = { tipos: ["GANHO"], nomes: ["ganho", "ganhos"] };

export type EventoMeta = "LeadSubmitted" | "Purchase";

/** Qual evento da Meta (se algum) corresponde a um lead ter entrado nesta coluna. */
export function eventoDaColuna(coluna: { type: string; name: string }): EventoMeta | null {
  const nome = normalizarNome(coluna.name);
  if (COLUNAS_GANHO.tipos.includes(coluna.type) || COLUNAS_GANHO.nomes.includes(nome)) return "Purchase";
  if (COLUNAS_QUALIFICADO.tipos.includes(coluna.type) || COLUNAS_QUALIFICADO.nomes.includes(nome)) return "LeadSubmitted";
  return null;
}

/** Painel de anúncios: o lead está em Qualificados ou numa etapa posterior (inclui Ganho)? */
export function ehQualificadoOuAlem(coluna: { type: string; name: string }): boolean {
  return eventoDaColuna(coluna) !== null || TIPOS_ALEM_DE_QUALIFICADO.includes(coluna.type);
}
