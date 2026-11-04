import type { Criterio } from "./modelo";
import { diasDesde } from "@/lib/funil/encerramento";
import { calcularSaudeEntrega, type CartaoParaSaude } from "@/lib/entrega/saude";

export interface ContextoOportunidade {
  etapaId: string; funilId: string; probabilidade: string | null; origem: string | null; valorTotal: number; tags: string[];
  diasNaEtapa: number; diasSemAtividade: number; semResponsavel: boolean;
  // Só nos gatilhos de entrega (da entrega inteira):
  notaSaude?: number; diasParaRenovar?: number;
  // Só nos gatilhos de cartão:
  pilar?: string; diasDeAtraso?: number; diasAguardandoCliente?: number; cartaoDoCliente?: boolean;
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

export interface CartaoParaContexto extends CartaoParaSaude { pilar: string; cliente: boolean }

/** Dias inteiros de atraso (0 se não venceu ou já está concluído). */
export function diasDeAtraso(c: { coluna: string; dataAlvo: Date | null }, agora: Date): number {
  if (c.coluna === "CONCLUIDO" || !c.dataAlvo || c.dataAlvo.getTime() >= agora.getTime()) return 0;
  return Math.max(1, Math.floor((agora.getTime() - c.dataAlvo.getTime()) / 86_400_000));
}

/** Dias parado em "Aguardando o cliente" (0 se está em outra coluna). */
export function diasAguardandoCliente(c: { coluna: string; colunaDesdeEm: Date }, agora: Date): number {
  return c.coluna === "AGUARDANDO_CLIENTE" ? diasDesde(c.colunaDesdeEm, agora) : 0;
}

/** Contexto de um gatilho de entrega: o da oportunidade, mais a saúde da entrega e, se houver, o cartão. */
export function contextoDaEntrega(
  base: ContextoOportunidade,
  entrega: { renovacaoEm: Date | null; cartoes: CartaoParaSaude[] },
  cartao: CartaoParaContexto | null,
  agora: Date = new Date(),
): ContextoOportunidade {
  const saude = calcularSaudeEntrega(entrega.cartoes, entrega.renovacaoEm, agora);
  return {
    ...base,
    notaSaude: saude.nota,
    ...(saude.diasParaRenovar !== null && { diasParaRenovar: saude.diasParaRenovar }),
    ...(cartao && {
      pilar: cartao.pilar, diasDeAtraso: diasDeAtraso(cartao, agora), diasAguardandoCliente: diasAguardandoCliente(cartao, agora), cartaoDoCliente: cartao.cliente,
    }),
  };
}

/** Todos os critérios precisam valer (E). Lista vazia vale sempre. Campo que não existe no contexto não vale. */
export function avaliarCriterios(criterios: Criterio[], ctx: ContextoOportunidade): boolean {
  return criterios.every((c) => {
    if (c.campo === "tag") {
      const tem = ctx.tags.includes(String(c.valor));
      return c.operador === "=" ? tem : !tem;
    }
    const atual = ctx[c.campo];
    if (atual === undefined) return false; // ex.: "dias para renovar" numa entrega sem data de renovação
    switch (c.operador) {
      case "=": return typeof atual === "number" ? atual === Number(c.valor) : atual === c.valor;
      case "!=": return atual !== c.valor;
      case ">=": return Number(atual) >= Number(c.valor);
      case "<=": return Number(atual) <= Number(c.valor);
    }
  });
}
