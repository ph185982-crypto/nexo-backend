// Contrato de um combinado: o que é, quem cumpre, até quando. Valida o que vem da tela e o que vem do agente.
import { ErroEntrada, escolha, texto } from "@/lib/validar";
import { PILARES } from "@/lib/entrega/constantes";

export const TIPOS_COMBINADO = ["ENTREGAVEL", "REUNIAO", "TAREFA"] as const;
export const RESPONSAVEIS = ["NOS", "CLIENTE"] as const;
export const STATUS_COMBINADO = ["SUGERIDO", "PENDENTE", "ENTREGUE", "DESCARTADO", "APLICADA"] as const;
export const ACOES_COMBINADO = ["NOVO", "CONCLUIR", "ATUALIZAR_PRAZO"] as const;
export type TipoCombinado = (typeof TIPOS_COMBINADO)[number];
export type Responsavel = (typeof RESPONSAVEIS)[number];
export type AcaoCombinado = (typeof ACOES_COMBINADO)[number];

export const ROTULO_TIPO_COMBINADO: Record<TipoCombinado, string> = { ENTREGAVEL: "Entregável", REUNIAO: "Reunião", TAREFA: "Tarefa" };
export const ROTULO_RESPONSAVEL: Record<Responsavel, string> = { NOS: "Nós", CLIENTE: "Cliente" };
export const ROTULO_STATUS_COMBINADO: Record<(typeof STATUS_COMBINADO)[number], string> = {
  SUGERIDO: "Sugerido", PENDENTE: "Pendente", ENTREGUE: "Entregue", DESCARTADO: "Descartado", APLICADA: "Aplicada",
};

export interface DadosCombinado {
  descricao: string; tipo: TipoCombinado; responsavel: Responsavel; prazoEm: Date | null; pilar: string | null;
}

/** "2026-11-20" ou "2026-11-20T14:30" (horário de Brasília) → Date. Sem hora, vale o fim do dia útil (18h). */
export function lerPrazo(v: unknown, hora?: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (!m) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new ErroEntrada("Prazo inválido");
    return d;
  }
  const h = /^(\d{2}):(\d{2})$/.exec(String(hora ?? ""));
  const [hh, mm] = m[4] ? [m[4], m[5]] : h ? [h[1], h[2]] : ["18", "00"];
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${hh}:${mm}:00-03:00`);
  if (Number.isNaN(d.getTime())) throw new ErroEntrada("Prazo inválido");
  return d;
}

export function validarCombinado(corpo: unknown): DadosCombinado {
  const o = (corpo ?? {}) as Record<string, unknown>;
  const pilar = o.pilar === null || o.pilar === undefined || o.pilar === "" ? null : escolha(o.pilar, "pilar", PILARES);
  return {
    descricao: texto(o.descricao, "Descrição", { min: 3, max: 300 }),
    tipo: escolha(o.tipo, "tipo", TIPOS_COMBINADO, "ENTREGAVEL"),
    responsavel: escolha(o.responsavel, "responsável", RESPONSAVEIS, "NOS"),
    prazoEm: lerPrazo(o.prazoEm ?? o.prazo, o.hora),
    pilar,
  };
}

/** Edição parcial (PATCH): só os campos enviados. */
export function validarEdicao(corpo: Record<string, unknown>): Partial<DadosCombinado> {
  const out: Partial<DadosCombinado> = {};
  if (corpo.descricao !== undefined) out.descricao = texto(corpo.descricao, "Descrição", { min: 3, max: 300 });
  if (corpo.tipo !== undefined) out.tipo = escolha(corpo.tipo, "tipo", TIPOS_COMBINADO);
  if (corpo.responsavel !== undefined) out.responsavel = escolha(corpo.responsavel, "responsável", RESPONSAVEIS);
  if (corpo.prazoEm !== undefined) out.prazoEm = lerPrazo(corpo.prazoEm, corpo.hora);
  if (corpo.pilar !== undefined) out.pilar = corpo.pilar === null || corpo.pilar === "" ? null : escolha(corpo.pilar, "pilar", PILARES);
  return out;
}

/** Para comparar descrições ("Entregar o BI" ≈ "entregar o bi!"): minúsculas, sem acento nem pontuação. */
export function normalizarDescricao(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

