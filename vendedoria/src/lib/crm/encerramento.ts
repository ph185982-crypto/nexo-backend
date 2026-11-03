// Regra pura (sem banco): quais etapas do funil encerram o negócio.
// Compartilhada entre o servidor (historico-etapa.ts) e a tela do kanban.

export type TipoEncerramento = "GANHO" | "PERDA";

const TIPOS_GANHO = new Set(["GANHO"]);
const TIPOS_PERDA = new Set(["LOST", "DESCARTADO", "JUNK"]);

/** GANHO / PERDA se a coluna é uma etapa final; null se o negócio segue em aberto. */
export function tipoEncerramento(tipoColuna: string): TipoEncerramento | null {
  if (TIPOS_GANHO.has(tipoColuna)) return "GANHO";
  if (TIPOS_PERDA.has(tipoColuna)) return "PERDA";
  return null;
}
