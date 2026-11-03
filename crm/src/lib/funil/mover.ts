// ─── Único lugar que cria oportunidade ou troca a etapa dela ─────────────────
//
// Cada troca grava, na mesma transação: etapa e funil, relógio da etapa
// (etapaDesdeEm), encerramento (status, encerradaEm, motivo) e uma linha em
// HistoricoEtapa. É isso que mede conversão por etapa, tempo parado e ciclo.
//
// Regra do projeto: nenhum outro arquivo de src/ escreve etapaId/funilId numa
// oportunidade. tests/funil-guarda.test.ts falha se aparecer um.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { statusDaEtapa, tipoMotivoDaEtapa } from "./encerramento";
import { criarEntregaDaOportunidade } from "@/lib/entrega/criar";

type Db = Prisma.TransactionClient;

export type OrigemEtapa = "CRIACAO" | "MANUAL" | "INTEGRACAO" | "AUTOMACAO" | "IMPORTACAO";

export interface MudancaEtapa {
  oportunidadeId: string;
  etapaId: string;
  origem: OrigemEtapa;
  /** Quem fez: id do usuário, "vendedor-ia", "automacao"… */
  ator?: string | null;
  /** Texto livre que fica na linha do histórico. */
  motivo?: string | null;
  /** Motivo de ganho/perda do catálogo. Ignorado se o tipo não combina com a etapa ou estiver desativado. */
  motivoId?: string | null;
  motivoDetalhe?: string | null;
  quando?: Date;
}

export interface ResultadoMudanca {
  mudou: boolean;
  de: { etapaId: string; etapaNome: string; funilNome: string } | null;
}

export async function moverOportunidade(m: MudancaEtapa, db?: Db): Promise<ResultadoMudanca> {
  const run = async (tx: Db): Promise<ResultadoMudanca> => {
    const [op, destino] = await Promise.all([
      tx.oportunidade.findUnique({
        where: { id: m.oportunidadeId },
        select: { etapaId: true, etapaDesdeEm: true, etapa: { select: { id: true, nome: true, tipo: true, funil: { select: { nome: true } } } } },
      }),
      tx.etapa.findUnique({ where: { id: m.etapaId }, select: { id: true, nome: true, tipo: true, funilId: true, funil: { select: { nome: true, ativo: true } } } }),
    ]);
    if (!op) throw new Error("Oportunidade não encontrada");
    if (!destino) throw new Error("Etapa não encontrada");
    const de = { etapaId: op.etapa.id, etapaNome: op.etapa.nome, funilNome: op.etapa.funil.nome };
    if (op.etapaId === destino.id) return { mudou: false, de };
    if (!destino.funil.ativo) throw new Error("Funil desativado");

    const agora = m.quando ?? new Date();
    const fechadas = await tx.historicoEtapa.updateMany({ where: { oportunidadeId: m.oportunidadeId, saiuEm: null }, data: { saiuEm: agora } });
    if (fechadas.count === 0) {
      // sem linha aberta (importada, ou criada por caminho esquecido): reconstrói a etapa anterior
      await tx.historicoEtapa.create({
        data: {
          oportunidadeId: m.oportunidadeId, paraEtapaId: op.etapa.id, paraFunilNome: de.funilNome, paraEtapaNome: de.etapaNome,
          paraTipo: op.etapa.tipo, entrouEm: op.etapaDesdeEm, saiuEm: agora, origem: "IMPORTACAO",
        },
      });
    }
    await tx.historicoEtapa.create({
      data: {
        oportunidadeId: m.oportunidadeId,
        deEtapaId: de.etapaId, deFunilNome: de.funilNome, deEtapaNome: de.etapaNome,
        paraEtapaId: destino.id, paraFunilNome: destino.funil.nome, paraEtapaNome: destino.nome, paraTipo: destino.tipo,
        entrouEm: agora, origem: m.origem, ator: m.ator ?? null, motivo: m.motivo ?? null,
      },
    });

    const tipoNovo = tipoMotivoDaEtapa(destino.tipo);
    const tipoAntigo = tipoMotivoDaEtapa(op.etapa.tipo);
    let motivoValido: string | null = null;
    if (m.motivoId && tipoNovo) {
      const cat = await tx.motivoEncerramento.findUnique({ where: { id: m.motivoId } });
      if (cat && cat.ativo && cat.tipo === tipoNovo) motivoValido = cat.id;
    }
    // Trocar de natureza (aberta → ganha, perdida → ganha…) invalida o motivo anterior.
    const motivoMuda = motivoValido !== null || tipoNovo !== tipoAntigo;

    await tx.oportunidade.update({
      where: { id: m.oportunidadeId },
      data: {
        etapaId: destino.id,
        funilId: destino.funilId,
        status: statusDaEtapa(destino.tipo),
        etapaDesdeEm: agora,
        encerradaEm: tipoNovo ? agora : null,
        ultimaAtividadeEm: agora,
        ...(motivoMuda && { motivoId: motivoValido, motivoDetalhe: motivoValido ? (m.motivoDetalhe?.trim().slice(0, 500) || null) : null }),
      },
    });
    // Ganhou: a entrega nasce na mesma transação (idempotente: ganhar de novo não duplica).
    if (destino.tipo === "GANHA") await criarEntregaDaOportunidade(tx, m.oportunidadeId, agora);
    return { mudou: true, de };
  };
  return db ? run(db) : prisma.$transaction(run);
}

export interface NovaOportunidade {
  nome: string;
  contatoId: string;
  pessoaId?: string | null;
  /** Funil de entrada; se faltar, o funil padrão. */
  funilId?: string | null;
  /** Etapa de entrada; se faltar, a primeira etapa aberta do funil. */
  etapaId?: string | null;
  responsavelId?: string | null;
  valorUnico?: number;
  valorMensal?: number;
  probabilidade?: string | null;
  origem?: string | null;
  tags?: string[];
  finalizaEm?: Date | null;
  vendedorIaLeadId?: string | null;
  origemHistorico?: OrigemEtapa;
  ator?: string | null;
}

export async function criarOportunidade(n: NovaOportunidade, db?: Db) {
  const run = async (tx: Db) => {
    let etapa;
    if (n.etapaId) {
      etapa = await tx.etapa.findUnique({ where: { id: n.etapaId }, include: { funil: true } });
    } else {
      const funil = n.funilId
        ? await tx.funil.findUnique({ where: { id: n.funilId } })
        : await tx.funil.findFirst({ where: { padrao: true, ativo: true }, orderBy: { ordem: "asc" } });
      if (!funil) throw new Error("Funil não encontrado");
      etapa = await tx.etapa.findFirst({ where: { funilId: funil.id, tipo: "ABERTA" }, orderBy: { ordem: "asc" }, include: { funil: true } });
    }
    if (!etapa) throw new Error("Etapa de entrada não encontrada");
    const agora = new Date();
    const encerra = tipoMotivoDaEtapa(etapa.tipo) !== null;
    const op = await tx.oportunidade.create({
      data: {
        nome: n.nome.trim(),
        contatoId: n.contatoId,
        pessoaId: n.pessoaId ?? null,
        funilId: etapa.funilId,
        etapaId: etapa.id,
        status: statusDaEtapa(etapa.tipo),
        responsavelId: n.responsavelId ?? null,
        valorUnico: n.valorUnico ?? 0,
        valorMensal: n.valorMensal ?? 0,
        probabilidade: n.probabilidade ?? null,
        origem: n.origem ?? null,
        tags: n.tags ?? [],
        finalizaEm: n.finalizaEm ?? null,
        vendedorIaLeadId: n.vendedorIaLeadId ?? null,
        etapaDesdeEm: agora,
        ultimaAtividadeEm: agora,
        encerradaEm: encerra ? agora : null,
      },
    });
    await tx.historicoEtapa.create({
      data: {
        oportunidadeId: op.id, paraEtapaId: etapa.id, paraFunilNome: etapa.funil.nome, paraEtapaNome: etapa.nome,
        paraTipo: etapa.tipo, entrouEm: agora, origem: n.origemHistorico ?? "CRIACAO", ator: n.ator ?? null,
      },
    });
    if (etapa.tipo === "GANHA") await criarEntregaDaOportunidade(tx, op.id, agora); // criada já ganha
    return op;
  };
  return db ? run(db) : prisma.$transaction(run);
}
