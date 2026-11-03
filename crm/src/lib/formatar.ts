export function moeda(v: number): string {
  if (v < 1000) return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (v < 10_000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  if (v < 1_000_000) return `R$ ${Math.round(v / 1000)} mil`;
  return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
}

export const data = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
export const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export const PROBABILIDADE: Record<string, string> = { RISCO_ALTO: "Risco alto", FRIA: "Fria", MORNA: "Morna", QUENTE: "Quente" };

/** Parado há tanto tempo muda o indicador: laranja (atenção) a partir de 7 dias, vermelho (grave) a partir de 14. */
export const PARADO_ATENCAO_DIAS = 7;
export const PARADO_CRITICO_DIAS = 14;
export const nivelParado = (dias: number): "ok" | "atencao" | "critico" =>
  dias >= PARADO_CRITICO_DIAS ? "critico" : dias >= PARADO_ATENCAO_DIAS ? "atencao" : "ok";
