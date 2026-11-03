import { ErroEntrada } from "@/lib/validar";

const BRT_MS = 3 * 3_600_000;
export interface Periodo { de: Date; ate: Date } // [de, ate)

/** Datas AAAA-MM-DD em Brasília; `ate` é inclusivo. Sem parâmetros: mês atual. Máximo de 400 dias. */
export function lerPeriodo(de: string | null, ate: string | null, agora: Date = new Date()): Periodo {
  const dia = (s: string, campo: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + BRT_MS) : null;
    if (!d || Number.isNaN(d.getTime()) || d.getUTCMonth() !== +m![2] - 1) throw new ErroEntrada(`${campo} inválida (use AAAA-MM-DD)`);
    return d;
  };
  if (!de && !ate) {
    const l = new Date(agora.getTime() - BRT_MS);
    return { de: new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1) + BRT_MS), ate: new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth() + 1, 1) + BRT_MS) };
  }
  if (!de || !ate) throw new ErroEntrada("Informe de e ate");
  const p = { de: dia(de, "de"), ate: new Date(dia(ate, "ate").getTime() + 86_400_000) };
  if (p.ate <= p.de) throw new ErroEntrada("ate precisa ser depois de de");
  if (p.ate.getTime() - p.de.getTime() > 400 * 86_400_000) throw new ErroEntrada("Período máximo de 400 dias");
  return p;
}
