// Livro-razão do financeiro: regra do produto — "a ferramenta nunca pode perder
// o histórico, todos os lançamentos precisam ser gravados".
//
// Em vez de tocar cada ponto de escrita (telas, bot do WhatsApp, crons,
// scripts), instalamos um middleware no PrismaClient compartilhado: toda
// criação, alteração e exclusão nos modelos financeiros grava um retrato da
// linha em HistoricoFinanceiro (antes e depois).
//
// Garantias:
//  • Exclusões são gravadas ANTES de executar. Se o registro no histórico
//    falhar, a exclusão é abortada (falha fechada) — nunca some um lançamento
//    sem deixar cópia.
//  • Criações/alterações são gravadas logo depois; se o registro falhar, o
//    erro é logado mas a operação do usuário não é derrubada.
//  • O histórico em si nunca é apagado nem alterado por este código.

import type { PrismaClient } from "@prisma/client";

/** Modelos financeiros auditados. */
export const MODELOS_FINANCEIROS_AUDITADOS = [
  "Transacao",
  "ReceitaPrevistaMax",
  "ContaPagarMax",
  "DividaMax",
  "OrcamentoMax",
  "MetaFinanceiraMax",
  "ContratoReceita",
  "FinancialTransaction",
  "RecurringBill",
  "InstallmentPlan",
  "FinancialAccount",
] as const;

const AUDITADOS = new Set<string>(MODELOS_FINANCEIROS_AUDITADOS);
const ESCRITAS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const LIMITE_LOTE = 1000;
const MARCA = Symbol.for("nexo.historicoFinanceiro.instalado");

/* eslint-disable @typescript-eslint/no-explicit-any */
type Linha = Record<string, any>;

function delegateDe(client: PrismaClient, model: string): any {
  return (client as any)[model.charAt(0).toLowerCase() + model.slice(1)];
}

/** Garante JSON puro (Date → ISO string etc.) antes de gravar no campo Json. */
function limpar(v: unknown): any {
  return v == null ? null : JSON.parse(JSON.stringify(v));
}

interface Entrada {
  entidade: string;
  entidade_id: string;
  acao: "criado" | "atualizado" | "excluido";
  antes: unknown;
  depois: unknown;
}

async function gravar(client: PrismaClient, entradas: Entrada[]): Promise<string[]> {
  if (entradas.length === 0) return [];
  const registros = await Promise.all(
    entradas.map((e) =>
      client.historicoFinanceiro.create({
        data: {
          entidade: e.entidade,
          entidade_id: e.entidade_id,
          acao: e.acao,
          antes: limpar(e.antes) ?? undefined,
          depois: limpar(e.depois) ?? undefined,
        },
        select: { id: true },
      }),
    ),
  );
  return registros.map((r) => r.id);
}

export function instalarHistoricoFinanceiro(client: PrismaClient): void {
  const marcado = client as unknown as Record<symbol, boolean>;
  if (marcado[MARCA]) return; // hot-reload em dev reaproveita o client
  marcado[MARCA] = true;

  client.$use(async (params, next) => {
    const { model, action } = params;
    if (!model || !AUDITADOS.has(model) || !ESCRITAS.has(action)) return next(params);

    const del = delegateDe(client, model);
    const args = (params.args ?? {}) as Linha;
    const ehExclusao = action === "delete" || action === "deleteMany";

    // 1) Retrato de "antes"
    let antes: Linha[] = [];
    try {
      if (action === "update" || action === "delete" || action === "upsert") {
        const r = await del.findUnique({ where: args.where });
        if (r) antes = [r];
      } else if (action === "updateMany" || action === "deleteMany") {
        antes = await del.findMany({ where: args.where, take: LIMITE_LOTE });
      }
    } catch (e) {
      if (ehExclusao) {
        throw new Error(`[Histórico] Exclusão cancelada: não foi possível guardar cópia de ${model}. ${String(e)}`);
      }
      console.error(`[Histórico] Falha ao ler estado anterior de ${model}:`, e);
    }

    // 2) Exclusão: grava ANTES de executar (falha fechada)
    let idsPreGravados: string[] = [];
    if (ehExclusao) {
      try {
        idsPreGravados = await gravar(
          client,
          antes.map((a) => ({ entidade: model, entidade_id: String(a.id), acao: "excluido", antes: a, depois: null })),
        );
      } catch (e) {
        throw new Error(`[Histórico] Exclusão cancelada: não foi possível registrar o histórico de ${model}. ${String(e)}`);
      }
    }

    // 3) Executa a operação
    let resultado: any;
    try {
      resultado = await next(params);
    } catch (e) {
      // A exclusão não aconteceu — retira o registro de "excluído" que gravamos por antecipação.
      if (idsPreGravados.length) {
        await client.historicoFinanceiro.deleteMany({ where: { id: { in: idsPreGravados } } }).catch(() => {});
      }
      throw e;
    }

    // 4) Criações e alterações: grava depois (melhor esforço)
    try {
      if (action === "create") {
        await gravar(client, [{ entidade: model, entidade_id: String(resultado.id), acao: "criado", antes: null, depois: resultado }]);
      } else if (action === "createMany") {
        const linhas: Linha[] = Array.isArray(args.data) ? args.data : args.data ? [args.data] : [];
        await gravar(
          client,
          linhas.map((l) => ({ entidade: model, entidade_id: String(l.id ?? "novo"), acao: "criado", antes: null, depois: l })),
        );
      } else if (action === "update") {
        await gravar(client, [{ entidade: model, entidade_id: String(resultado.id), acao: "atualizado", antes: antes[0] ?? null, depois: resultado }]);
      } else if (action === "upsert") {
        await gravar(client, [
          {
            entidade: model,
            entidade_id: String(resultado.id),
            acao: antes[0] ? "atualizado" : "criado",
            antes: antes[0] ?? null,
            depois: resultado,
          },
        ]);
      } else if (action === "updateMany" && antes.length) {
        const depoisRows: Linha[] = await del.findMany({ where: { id: { in: antes.map((a) => a.id) } } });
        const porId = new Map(depoisRows.map((r) => [String(r.id), r]));
        await gravar(
          client,
          antes.map((a) => ({
            entidade: model,
            entidade_id: String(a.id),
            acao: "atualizado" as const,
            antes: a,
            depois: porId.get(String(a.id)) ?? null,
          })),
        );
      }
    } catch (e) {
      console.error(`[Histórico] Falha ao registrar ${action} em ${model}:`, e);
    }

    return resultado;
  });
}
