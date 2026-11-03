// Constantes puras de contatos (sem banco) — usadas também pelo navegador.
export const TIPOS_CONTATO = ["EMPRESA", "PESSOA"] as const;
export const CICLOS = ["LEAD", "PROSPECT", "CLIENTE", "DESCARTADO"] as const;
export const ROTULO_CICLO: Record<string, string> = { LEAD: "Lead", PROSPECT: "Prospect", CLIENTE: "Cliente", DESCARTADO: "Descartado" };
