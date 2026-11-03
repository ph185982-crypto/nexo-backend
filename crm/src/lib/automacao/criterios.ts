import type { Criterio } from "./modelo";
import { diasDesde } from "@/lib/funil/encerramento";

export interface ContextoOportunidade {
  etapaId: string; funilId: string; probabilidade: string | null; origem: string | null; valorTotal: number; tags: string[];
  diasNaEtapa: number; diasSemAtividade: number; semResponsavel: boolean;
}

export function contextoDaOportunidade(o: {
  etapaId: string; funilId: string; probabilidade: string | null; origem: string | null; valorUnico: { toString(): string }; valorMensal: { toString(): string };
  tags: string[]; etapaDesdeEm: Date; ultimaAtividadeEm: Date; responsavelId: string | null;
}, agora: Date = new Date()): ContextoOportunidade {
  return {
    etapaId: o.etapaId, funilId: o.funilId, probabilidade: o.probabilidade, origem: o.origem,
    valorTotal: Number(o.valorUnico.toString()) + Number(o.valorMensal.toString()), tags: o.tags,
    diasNaEtapa: diasDesde(o.etapaDesdeEm, agora), diasSemAtividade: diasDesde(o.ultimaAtividadeEm, agora), semResponsavel: o.responsavelId === null,
  };
}

/** Todos os critérios precisam valer (E). Lista vazia vale sempre. */
export function avaliarCriterios(criterios: Criterio[], ctx: ContextoOportunidade): boolean {
  return criterios.every((c) => {
    const atual = c.campo === "tag" ? ctx.tags : ctx[c.campo];
    if (c.campo === "tag") {
      const tem = ctx.tags.includes(String(c.valor));
      return c.operador === "=" ? tem : !tem;
    }
    switch (c.operador) {
      case "=": return typeof atual === "number" ? atual === Number(c.valor) : atual === c.valor;
      case "!=": return atual !== c.valor;
      case ">=": return Number(atual) >= Number(c.valor);
      case "<=": return Number(atual) <= Number(c.valor);
    }
  });
}
