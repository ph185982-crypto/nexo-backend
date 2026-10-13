// Regra de qualificação do SDR: loja física SIM + faturamento a partir do mínimo
// mensal + CNPJ SIM. Funções puras sobre a sessão do SDR.

import { FATURAMENTO_MINIMO_MENSAL } from "@/lib/crm/funil-config";
import type { SDRSession } from "./types";

const NEGACAO = /^(nao|n[aã]o|sem|nenhum|nada|ainda nao|ainda n[aã]o|vou |vai |pretendo|pretende|quero abrir|em abertura|abrindo)\b/i;
const AFIRMACAO = /\b(sim|tem|tenho|possuo|possui|temos|ativo|aberto|mei|ltda|eireli|slu)\b/i;

/** Há um CNPJ confirmado? Aceita o número (14 dígitos) ou uma afirmação ("sim, tenho"). */
export function temCnpjConfirmado(cnpj: string | null | undefined): boolean {
  const t = (cnpj ?? "").trim();
  if (!t) return false;
  const digitos = t.replace(/\D/g, "");
  if (digitos.length === 14) return true;
  const semAcento = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (NEGACAO.test(semAcento)) return false;
  return AFIRMACAO.test(semAcento);
}

/** "R$ 40 mil", "40k", "50.000", "1,5 milhão", "600 mil por ano" → faturamento MENSAL em reais, ou null. */
export function parseFaturamentoMensal(valor: string | null | undefined): number | null {
  if (!valor) return null;
  const t = valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // Faixa "30 a 50 mil": usa o piso (conservador — só qualifica se o piso bate).
  const faixa = t.match(/(\d[\d.,]*)\s*(?:a|ate|-|e)\s*(\d[\d.,]*)\s*(mil|k|milhao|milhoes|mi)?/);
  const numStr = faixa ? faixa[1] : (t.match(/\d[\d.,]*/)?.[0] ?? null);
  if (!numStr) return null;
  const sufixo = (faixa ? faixa[3] : t.match(/\d[\d.,]*\s*(mil|k|milhao|milhoes|mi)\b/)?.[1]) ?? "";

  // Número em formato BR ("1.500,50", "50.000") ou US ("50,000", "1.5")
  let n: number;
  if (numStr.includes(",") && numStr.includes(".")) {
    n = numStr.lastIndexOf(",") > numStr.lastIndexOf(".")
      ? Number(numStr.replace(/\./g, "").replace(",", "."))
      : Number(numStr.replace(/,/g, ""));
  } else if (numStr.includes(",")) {
    const depois = numStr.split(",")[1] ?? "";
    n = depois.length === 3 && !sufixo ? Number(numStr.replace(/,/g, "")) : Number(numStr.replace(",", "."));
  } else if (numStr.includes(".")) {
    const depois = numStr.split(".")[1] ?? "";
    n = depois.length === 3 ? Number(numStr.replace(/\./g, "")) : Number(numStr);
  } else {
    n = Number(numStr);
  }
  if (!Number.isFinite(n)) return null;

  if (sufixo === "mil" || sufixo === "k") n *= 1_000;
  else if (sufixo === "milhao" || sufixo === "milhoes" || sufixo === "mi") n *= 1_000_000;

  // "600 mil por ano" / "anual" → divide por 12
  if (/\b(por ano|ao ano|anual|anuais|\/ano|no ano)\b/.test(t)) n /= 12;
  return Math.round(n);
}

export interface ResultadoQualificacao {
  qualificado: boolean;
  /** O que ainda falta (ou não bate). Vazio quando qualificado. */
  faltando: Array<"loja_fisica" | "faturamento" | "cnpj">;
  faturamentoMensal: number | null;
}

const LOJA_FISICA_NOS_CANAIS = /loja\s*f[ií]sica|ponto\s*f[ií]sico|loja\s*pr[oó]pria|showroom/i;

/** Loja física confirmada: flag explícita do SDR ou o lead citou loja física entre os canais. */
export function temLojaFisicaConfirmada(
  s: Pick<SDRSession, "tem_loja_fisica"> & { canais_atuais?: string[] },
): boolean {
  if (s.tem_loja_fisica === true) return true;
  return (s.canais_atuais ?? []).some((c) => LOJA_FISICA_NOS_CANAIS.test(c.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) || LOJA_FISICA_NOS_CANAIS.test(c));
}

export function avaliarQualificacao(
  s: Pick<SDRSession, "tem_loja_fisica" | "faturamento_total" | "cnpj"> & { canais_atuais?: string[] },
  minimo = FATURAMENTO_MINIMO_MENSAL,
): ResultadoQualificacao {
  const faturamentoMensal = parseFaturamentoMensal(s.faturamento_total);
  const faltando: ResultadoQualificacao["faltando"] = [];
  if (!temLojaFisicaConfirmada(s)) faltando.push("loja_fisica");
  if (faturamentoMensal === null || faturamentoMensal < minimo) faltando.push("faturamento");
  if (!temCnpjConfirmado(s.cnpj)) faltando.push("cnpj");
  return { qualificado: faltando.length === 0, faltando, faturamentoMensal };
}
