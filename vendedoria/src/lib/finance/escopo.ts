// Escopo do financeiro: separa o que é da Nexo (empresa) do que é pessoal.
// O campo `tipo_negocio` já existe nas tabelas (pessoal | nexo | lukaizen | geral).
// Em ReceitaPrevistaMax ele é opcional — e vazio conta como pessoal (mesma regra
// que a confirmação de recebimento já usava).

export type Escopo = "todos" | "nexo" | "pessoal";

export function parseEscopo(v: string | null | undefined): Escopo {
  return v === "nexo" || v === "pessoal" ? v : "todos";
}

/** Filtro para tabelas onde tipo_negocio é obrigatório (Transacao, ContaPagarMax). */
export function whereEscopo(escopo: Escopo): { tipo_negocio?: string } {
  return escopo === "todos" ? {} : { tipo_negocio: escopo };
}

/** Filtro para ReceitaPrevistaMax, onde tipo_negocio pode ser nulo (= pessoal). */
export function whereEscopoReceita(escopo: Escopo): Record<string, unknown> {
  if (escopo === "nexo") return { tipo_negocio: "nexo" };
  if (escopo === "pessoal") return { OR: [{ tipo_negocio: "pessoal" }, { tipo_negocio: null }] };
  return {};
}

/** Classifica um tipo_negocio no bloco em que ele aparece no painel. */
export function blocoDoNegocio(tipo: string | null | undefined): "nexo" | "pessoal" | "outros" {
  if (!tipo || tipo === "pessoal") return "pessoal";
  if (tipo === "nexo") return "nexo";
  return "outros";
}
