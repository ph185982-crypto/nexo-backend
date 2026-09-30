// Geração automática das parcelas mensais de um contrato / parcelamento.
// Função pura (sem Prisma): o formulário usa a mesma conta para mostrar a
// prévia, então o que o usuário vê é exatamente o que será gravado.

import { ErroValidacao } from "./erros";
import { diasNoMes, parseData, toISODate } from "./periodo";

export interface ParcelaCalculada {
  numero: number;
  /** YYYY-MM-DD */
  data: string;
  valor: number;
}

export interface EntradaParcelas {
  /** Vencimento da 1ª parcela, YYYY-MM-DD */
  primeiroVencimento: string;
  /** Quantidade de parcelas (meses). */
  meses: number;
  /** Valor fixo de cada parcela — contrato recorrente. */
  valorParcela?: number;
  /** Total a dividir em `meses` parcelas — parcelamento. Tem prioridade sobre valorParcela. */
  valorTotal?: number;
  /** Dia do mês de vencimento; padrão = dia do primeiro vencimento. */
  diaVencimento?: number;
}

export const MAX_PARCELAS = 120;

/** Divide `total` em `n` parcelas em centavos; a sobra vai para as primeiras. */
export function dividirEmParcelas(total: number, n: number): number[] {
  const centavos = Math.round(total * 100);
  const base = Math.floor(centavos / n);
  const sobra = centavos - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < sobra ? 1 : 0)) / 100);
}

/** Vencimento da parcela `i` (0-based): mês a mês, com o dia limitado ao último dia do mês. */
export function vencimentoDaParcela(primeiro: Date, dia: number, i: number): Date {
  const y0 = primeiro.getUTCFullYear();
  const m0 = primeiro.getUTCMonth() + i; // pode passar de 11 — Date.UTC normaliza
  const ref = new Date(Date.UTC(y0, m0, 1));
  const d = Math.min(dia, diasNoMes(ref.getUTCFullYear(), ref.getUTCMonth() + 1));
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), d));
}

/** Lança erro com mensagem em português quando a entrada é inválida. */
export function gerarParcelas(e: EntradaParcelas): ParcelaCalculada[] {
  const primeiro = parseData(e.primeiroVencimento);
  if (!primeiro) throw new ErroValidacao("Data do primeiro vencimento inválida.");
  if (!Number.isInteger(e.meses) || e.meses < 1 || e.meses > MAX_PARCELAS) {
    throw new ErroValidacao(`Quantidade de meses deve ser um inteiro entre 1 e ${MAX_PARCELAS}.`);
  }
  const dia = e.diaVencimento ?? primeiro.getUTCDate();
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) throw new ErroValidacao("Dia de vencimento deve estar entre 1 e 31.");

  let valores: number[];
  if (e.valorTotal != null) {
    if (!(e.valorTotal > 0)) throw new ErroValidacao("Valor total deve ser maior que zero.");
    valores = dividirEmParcelas(e.valorTotal, e.meses);
  } else {
    if (e.valorParcela == null || !(e.valorParcela > 0)) throw new ErroValidacao("Valor da parcela deve ser maior que zero.");
    const v = Math.round(e.valorParcela * 100) / 100;
    valores = Array.from({ length: e.meses }, () => v);
  }

  return valores.map((valor, i) => ({
    numero: i + 1,
    data: toISODate(vencimentoDaParcela(primeiro, dia, i)),
    valor,
  }));
}
