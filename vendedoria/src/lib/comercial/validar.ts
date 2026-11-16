// Validação mínima de entrada das rotas. Devolve valor limpo ou lança ErroEntrada (→ 400).
export class ErroEntrada extends Error {}

export const texto = (v: unknown, campo: string, { min = 0, max = 500 }: { min?: number; max?: number } = {}): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < min) throw new ErroEntrada(`${campo} obrigatório`);
  if (s.length > max) throw new ErroEntrada(`${campo} passa de ${max} caracteres`);
  return s;
};

export const textoOpc = (v: unknown, campo: string, max = 500): string | null => {
  if (v === undefined || v === null || v === "") return null;
  return texto(v, campo, { max });
};

export const escolha = <T extends string>(v: unknown, campo: string, validos: readonly T[], padrao?: T): T => {
  if ((v === undefined || v === null || v === "") && padrao) return padrao;
  if (typeof v === "string" && (validos as readonly string[]).includes(v)) return v as T;
  throw new ErroEntrada(`${campo} inválido`);
};

export const dataOpc = (v: unknown, campo: string): Date | null => {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new ErroEntrada(`${campo} inválida`);
  return d;
};

export const dataObrig = (v: unknown, campo: string): Date => {
  const d = dataOpc(v, campo);
  if (!d) throw new ErroEntrada(`${campo} obrigatória`);
  return d;
};

/** Executa o handler e converte ErroEntrada em 400, e id que não existe (violação de chave estrangeira) em 400 também. */
export async function comEntrada(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErroEntrada) return Response.json({ erro: e.message }, { status: 400 });
    if ((e as { code?: string } | null)?.code === "P2003") return Response.json({ erro: "Referência inválida: um dos registros informados não existe" }, { status: 400 });
    throw e;
  }
}
