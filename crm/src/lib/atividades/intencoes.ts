// Sinal de intenção: lista fechada de 13 valores que classifica cada interação.
// Barato de marcar (à mão ou pela IA) e alimenta a saúde do negócio.
export const INTENCOES = [
  "BUDGET_SINALIZADO", "CONCORRENTE_IDENTIFICADO", "DECISOR_ENGAJADO", "DECISOR_IDENTIFICADO", "DECISAO_ADIADA",
  "DOR_CONFIRMADA", "ESCOPO_MUDOU", "NAO_COMPARECEU", "OBJECAO_PRECO", "PROVA_VALOR_ACEITA",
  "SEM_RETORNO", "SINAL_FECHAMENTO", "URGENCIA_DECLARADA",
] as const;
export type Intencao = (typeof INTENCOES)[number];

export const ROTULO_INTENCAO: Record<Intencao, string> = {
  BUDGET_SINALIZADO: "Budget sinalizado", CONCORRENTE_IDENTIFICADO: "Concorrente identificado", DECISOR_ENGAJADO: "Decisor engajado",
  DECISOR_IDENTIFICADO: "Decisor identificado", DECISAO_ADIADA: "Decisão adiada", DOR_CONFIRMADA: "Dor confirmada",
  ESCOPO_MUDOU: "Escopo mudou", NAO_COMPARECEU: "Não compareceu", OBJECAO_PRECO: "Objeção de preço",
  PROVA_VALOR_ACEITA: "Prova de valor aceita", SEM_RETORNO: "Sem retorno do cliente", SINAL_FECHAMENTO: "Sinal de fechamento",
  URGENCIA_DECLARADA: "Urgência declarada",
};

/** Peso de cada sinal na saúde do negócio (positivo ajuda, negativo atrapalha). */
export const PESO_INTENCAO: Record<Intencao, number> = {
  BUDGET_SINALIZADO: 12, CONCORRENTE_IDENTIFICADO: -5, DECISOR_ENGAJADO: 12, DECISOR_IDENTIFICADO: 6, DECISAO_ADIADA: -10,
  DOR_CONFIRMADA: 10, ESCOPO_MUDOU: -3, NAO_COMPARECEU: -12, OBJECAO_PRECO: -6, PROVA_VALOR_ACEITA: 12,
  SEM_RETORNO: -10, SINAL_FECHAMENTO: 20, URGENCIA_DECLARADA: 10,
};

export const TIPOS_FEEDBACK = ["NOTA", "LIGACAO", "WHATSAPP", "EMAIL", "REUNIAO", "SISTEMA"] as const;
