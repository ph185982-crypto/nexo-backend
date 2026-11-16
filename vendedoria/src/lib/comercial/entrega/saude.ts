import { COLUNAS } from "./constantes";

export type RotuloSaudeEntrega = "SAUDAVEL" | "ATENCAO" | "EM_RISCO";
export const ROTULO_SAUDE_ENTREGA: Record<RotuloSaudeEntrega, string> = { SAUDAVEL: "Saudável", ATENCAO: "Atenção", EM_RISCO: "Em risco" };

export interface CartaoParaSaude { coluna: string; dataAlvo: Date | null; colunaDesdeEm: Date }

export const DIAS_AGUARDANDO_CLIENTE = 7;
export const DIAS_ALERTA_RENOVACAO = 60;

/**
 * Saúde do cliente na entrega, 0–100: parte de 100, perde 12 pontos por cartão atrasado e 6 por cartão
 * parado em "Aguardando o cliente" há mais de 7 dias. ≥80 saudável, ≥50 atenção, senão em risco.
 * Progresso = concluídos / total. Renovação próxima é sinalizada à parte (não pesa na nota).
 */
export function calcularSaudeEntrega(cartoes: CartaoParaSaude[], renovacaoEm: Date | null, agora: Date = new Date()) {
  const abertos = cartoes.filter((c) => c.coluna !== "CONCLUIDO");
  const atrasados = abertos.filter((c) => c.dataAlvo && c.dataAlvo.getTime() < agora.getTime()).length;
  const esperandoCliente = cartoes.filter((c) => c.coluna === "AGUARDANDO_CLIENTE" && agora.getTime() - c.colunaDesdeEm.getTime() > DIAS_AGUARDANDO_CLIENTE * 86_400_000).length;
  const nota = Math.max(0, 100 - 12 * atrasados - 6 * esperandoCliente);
  const concluidos = cartoes.length - abertos.length;
  const diasParaRenovar = renovacaoEm ? Math.ceil((renovacaoEm.getTime() - agora.getTime()) / 86_400_000) : null;
  return {
    nota,
    rotulo: (nota >= 80 ? "SAUDAVEL" : nota >= 50 ? "ATENCAO" : "EM_RISCO") as RotuloSaudeEntrega,
    progresso: cartoes.length ? Math.round((concluidos / cartoes.length) * 100) : 0,
    total: cartoes.length, concluidos, atrasados, esperandoCliente,
    diasParaRenovar,
    renovacaoProxima: diasParaRenovar !== null && diasParaRenovar <= DIAS_ALERTA_RENOVACAO,
    porColuna: Object.fromEntries(COLUNAS.map((k) => [k, cartoes.filter((c) => c.coluna === k).length])) as Record<string, number>,
  };
}
