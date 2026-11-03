// Constantes puras (sem banco) — usadas também pelo navegador.
export const TIPOS_TAREFA = ["TAREFA", "LIGACAO", "EMAIL", "WHATSAPP", "REUNIAO"] as const;
export const PRIORIDADES = ["BAIXA", "NORMAL", "ALTA"] as const;
export const RECORRENCIAS = ["DIARIA", "SEMANAL", "MENSAL"] as const;
export type Visao = "hoje" | "atrasadas" | "proximos7" | "abertas" | "concluidas";
export const VISOES: readonly Visao[] = ["hoje", "atrasadas", "proximos7", "abertas", "concluidas"];
