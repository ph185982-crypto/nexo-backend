// Escopo (Empresa × Pessoal) das linhas do livro-razão (HistoricoFinanceiro), para a API de serviço da Central.
// O histórico não tem coluna de escopo: ele vem do retrato da linha (`depois`, ou `antes` quando foi excluída). Regras:
//  • tipo_negocio "nexo" = empresa; "pessoal" = pessoal. Em ReceitaPrevistaMax e MetaFinanceiraMax vazio vale pessoal.
//  • DividaMax, OrcamentoMax e AporteMetaMax só existem no pessoal (não há campo de negócio).
//  • DreClassificacaoMax e os modelos legados (FinancialTransaction…) não têm escopo: ficam FORA dos dois (nunca vazam).
//  • Vale o estado mais recente: uma linha reclassificada Empresa → Pessoal aparece só no Pessoal (o `depois` manda).
// A mesma regra existe em JS (`escopoDoHistorico`, usada para conferir um id) e em filtro do Prisma (`filtroEscopoHistorico`,
// usado na listagem paginada); o teste confere que as duas dão o mesmo resultado.
import { Prisma } from "@prisma/client";

export type EscopoHist = "nexo" | "pessoal";

const COM_CAMPO = ["Transacao", "ContaPagarMax", "ContratoReceita", "ContratoDespesa"] as const;
const VAZIO_E_PESSOAL = ["ReceitaPrevistaMax", "MetaFinanceiraMax"] as const;
const SO_PESSOAL = ["DividaMax", "OrcamentoMax", "AporteMetaMax"] as const;

/** Entidades que podem aparecer em cada escopo (para o filtro de tipo da tela). */
export const ENTIDADES_DO_ESCOPO: Record<EscopoHist, readonly string[]> = {
  nexo: [...COM_CAMPO, ...VAZIO_E_PESSOAL],
  pessoal: [...COM_CAMPO, ...VAZIO_E_PESSOAL, ...SO_PESSOAL],
};

type Snap = Record<string, unknown> | null | undefined;

export function escopoDoHistorico(entidade: string, antes: unknown, depois: unknown): EscopoHist | null {
  if ((SO_PESSOAL as readonly string[]).includes(entidade)) return "pessoal";
  const estaVazio = (VAZIO_E_PESSOAL as readonly string[]).includes(entidade);
  if (!estaVazio && !(COM_CAMPO as readonly string[]).includes(entidade)) return null;
  const s = ((depois ?? antes) as Snap) ?? {};
  const t = s.tipo_negocio;
  if (t === "nexo") return "nexo";
  if (t === "pessoal") return "pessoal";
  if ((t === null || t === undefined) && estaVazio) return "pessoal";
  return null; // lukaizen, geral… ficam fora dos dois escopos
}

const campoIgual = (coluna: "antes" | "depois", valor: string | typeof Prisma.JsonNull): Prisma.HistoricoFinanceiroWhereInput =>
  ({ [coluna]: { path: ["tipo_negocio"], equals: valor } }) as Prisma.HistoricoFinanceiroWhereInput;

/** Linhas cujo estado mais recente (depois; ou antes, se excluída) tem este tipo de negócio no campo. */
function porTipo(entidades: readonly string[], valor: string | typeof Prisma.JsonNull): Prisma.HistoricoFinanceiroWhereInput {
  return {
    entidade: { in: [...entidades] },
    OR: [campoIgual("depois", valor), { AND: [{ depois: { equals: Prisma.DbNull } }, campoIgual("antes", valor)] }],
  };
}

export function filtroEscopoHistorico(escopo: EscopoHist): Prisma.HistoricoFinanceiroWhereInput {
  if (escopo === "nexo") return porTipo([...COM_CAMPO, ...VAZIO_E_PESSOAL], "nexo");
  return {
    OR: [
      porTipo([...COM_CAMPO, ...VAZIO_E_PESSOAL], "pessoal"),
      porTipo(VAZIO_E_PESSOAL, Prisma.JsonNull), // campo vazio vale pessoal
      { entidade: { in: [...SO_PESSOAL] } },
    ],
  };
}
