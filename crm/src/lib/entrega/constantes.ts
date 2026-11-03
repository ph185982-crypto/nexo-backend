export const PILARES = ["COMERCIAL", "PRODUTO", "MARKETING", "OPERACAO", "FINANCEIRO", "TECNOLOGIA"] as const;
export type Pilar = (typeof PILARES)[number];
export const ROTULO_PILAR: Record<Pilar, string> = { COMERCIAL: "Comercial", PRODUTO: "Produto", MARKETING: "Marketing", OPERACAO: "Operação", FINANCEIRO: "Financeiro", TECNOLOGIA: "Tecnologia" };

export const COLUNAS = ["BACKLOG", "ESSA_SEMANA", "EM_ANDAMENTO", "AGUARDANDO_CLIENTE", "CONCLUIDO"] as const;
export type Coluna = (typeof COLUNAS)[number];
export const ROTULO_COLUNA: Record<Coluna, string> = { BACKLOG: "Backlog", ESSA_SEMANA: "Essa semana", EM_ANDAMENTO: "Em andamento", AGUARDANDO_CLIENTE: "Aguardando o cliente", CONCLUIDO: "Concluído" };

export const STATUS_ENTREGA = ["EM_ANDAMENTO", "PAUSADA", "CONCLUIDA", "CANCELADA"] as const;
export type StatusEntrega = (typeof STATUS_ENTREGA)[number];
export const ROTULO_STATUS_ENTREGA: Record<StatusEntrega, string> = { EM_ANDAMENTO: "Em andamento", PAUSADA: "Pausada", CONCLUIDA: "Concluída", CANCELADA: "Cancelada" };
