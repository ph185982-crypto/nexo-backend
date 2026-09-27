// Campos gravados por cada ação manual sobre uma empresa prospectada.

import type { Prisma } from "@prisma/client";
import { ACOES_MANUAIS, type AcaoManual } from "./status";

export function dadosDaAcao(acao: AcaoManual): Prisma.ProspectLeadUpdateManyMutationInput {
  const base = { status: ACOES_MANUAIS[acao].para };
  if (acao === "reprocessar") {
    // Volta ao início do pipeline: os sinais serão recalculados.
    return {
      ...base,
      score: null, analiseIA: null, motivoAnaliseIA: null,
      temAnuncioAtivo: null, instagramAtivo: null, followersIG: null, ultimaPostagemIG: null,
    };
  }
  return base;
}
