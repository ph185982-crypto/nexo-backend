// Competência e períodos do financeiro — funções puras, sem Prisma, para
// serem usadas no servidor (APIs) e no navegador (filtros e prévia de parcelas).
//
// Todas as datas são "só data" em UTC (meia-noite UTC), o mesmo formato que o
// Prisma devolve para colunas @db.Date.

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export type PeriodoTipo = "mes" | "dia" | "intervalo";

export interface Periodo {
  tipo: PeriodoTipo;
  de: Date;
  ate: Date;
  /** YYYY-MM — só quando tipo === "mes" */
  mes?: string;
  label: string;
}

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_MES = /^(\d{4})-(\d{2})$/;

export function parseData(s: string | null | undefined): Date | null {
  const m = s ? RE_DATA.exec(s) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Rejeita datas que "rolaram" (ex.: 2026-02-31)
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}

export function isMesValido(s: string | null | undefined): s is string {
  const m = s ? RE_MES.exec(s) : null;
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function mesDe(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function primeiroDiaDoMes(mes: string): Date {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

export function ultimoDiaDoMes(mes: string): Date {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0));
}

export function diasNoMes(ano: number, mes1a12: number): number {
  return new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();
}

export function somarMeses(mes: string, n: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return mesDe(d);
}

export function somarDias(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

export function labelMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} de ${y}`;
}

function labelData(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

/**
 * Resolve o período pedido. Sem parâmetros válidos → o mês de `hoje` (a
 * competência atual). Como `hoje` é a data de Brasília, na virada do dia 1º a
 * competência troca sozinha para o mês novo.
 */
export function resolverPeriodo(
  q: { mes?: string | null; dia?: string | null; de?: string | null; ate?: string | null },
  hoje: Date,
): Periodo {
  const dia = parseData(q.dia);
  if (dia) return { tipo: "dia", de: dia, ate: dia, label: labelData(dia) };

  const de = parseData(q.de);
  const ate = parseData(q.ate);
  if (de || ate) {
    let ini = de ?? ate!;
    let fim = ate ?? de!;
    if (ini > fim) [ini, fim] = [fim, ini];
    // Limite de segurança: no máximo ~1 ano por consulta
    if (fim.getTime() - ini.getTime() > 366 * 86_400_000) fim = somarDias(ini, 366);
    return { tipo: "intervalo", de: ini, ate: fim, label: `${labelData(ini)} a ${labelData(fim)}` };
  }

  const mes = isMesValido(q.mes) ? q.mes : mesDe(hoje);
  return { tipo: "mes", de: primeiroDiaDoMes(mes), ate: ultimoDiaDoMes(mes), mes, label: labelMes(mes) };
}

/** O período imediatamente anterior, de mesmo tamanho — base do comparativo. */
export function periodoAnterior(p: Periodo): Periodo {
  if (p.tipo === "mes" && p.mes) {
    const mes = somarMeses(p.mes, -1);
    return { tipo: "mes", de: primeiroDiaDoMes(mes), ate: ultimoDiaDoMes(mes), mes, label: labelMes(mes) };
  }
  const dias = Math.round((p.ate.getTime() - p.de.getTime()) / 86_400_000) + 1;
  const ate = somarDias(p.de, -1);
  const de = somarDias(ate, -(dias - 1));
  return {
    tipo: p.tipo,
    de,
    ate,
    label: p.tipo === "dia" ? labelData(de) : `${labelData(de)} a ${labelData(ate)}`,
  };
}
