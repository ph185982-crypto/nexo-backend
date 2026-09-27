export type AbaId = "geral" | "buscas" | "empresas" | "revisao" | "disparo" | "resultados";
export type Navegar = (aba: AbaId, params?: Record<string, string>) => void;
