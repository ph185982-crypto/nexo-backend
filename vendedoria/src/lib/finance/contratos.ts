// Contratos de receita: criação com geração automática das parcelas mensais,
// manutenção da janela de 12 meses dos contratos por prazo indeterminado e
// encerramento. Nada é apagado: parcelas ficam sempre gravadas (e auditadas).

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma/client";
import { getBrasiliaDateOnly } from "@/lib/max/config";
import { ErroValidacao } from "./erros";
import { gerarParcelas, vencimentoDaParcela, MAX_PARCELAS } from "./parcelas";
import { mesDe, parseData, somarMeses, toISODate } from "./periodo";

/** Quantos meses à frente um contrato por prazo indeterminado mantém gerados. */
export const JANELA_INDETERMINADO = 12;

export interface NovoContrato {
  descricao: string;
  cliente?: string | null;
  tipo_negocio?: string | null;
  /** recorrente = valor fixo por mês; parcelada = total dividido em N vezes */
  modo: "recorrente" | "parcelada";
  valor_parcela?: number;
  valor_total?: number;
  /** null/undefined só é aceito em contrato recorrente → prazo indeterminado */
  meses?: number | null;
  /** Vencimento da 1ª parcela, YYYY-MM-DD */
  primeiro_vencimento: string;
  dia_vencimento?: number;
  observacao?: string | null;
}

function tituloDaParcela(descricao: string, numero: number, total: number | null): string {
  return total ? `${descricao} — parcela ${numero}/${total}` : `${descricao} — parcela ${numero}`;
}

export async function criarContrato(entrada: NovoContrato) {
  const descricao = entrada.descricao?.trim();
  if (!descricao) throw new ErroValidacao("Informe a descrição do contrato.");
  const primeiro = parseData(entrada.primeiro_vencimento);
  if (!primeiro) throw new ErroValidacao("Data do primeiro vencimento inválida.");

  const indeterminado = entrada.meses == null;
  if (indeterminado && entrada.modo !== "recorrente") {
    throw new ErroValidacao("Só contratos recorrentes podem ter prazo indeterminado.");
  }
  const mesesGerar = indeterminado ? JANELA_INDETERMINADO : Number(entrada.meses);
  if (!indeterminado && (!Number.isInteger(mesesGerar) || mesesGerar < 1 || mesesGerar > MAX_PARCELAS)) {
    throw new ErroValidacao(`Duração do contrato deve ser de 1 a ${MAX_PARCELAS} meses.`);
  }

  const dia = entrada.dia_vencimento ?? primeiro.getUTCDate();
  const parcelas = gerarParcelas({
    primeiroVencimento: entrada.primeiro_vencimento,
    meses: mesesGerar,
    diaVencimento: dia,
    ...(entrada.modo === "parcelada"
      ? { valorTotal: entrada.valor_total }
      : { valorParcela: entrada.valor_parcela }),
  });

  const contratoId = randomUUID();
  const tipoNegocio = entrada.tipo_negocio?.trim() || "nexo";
  const cliente = entrada.cliente?.trim() || null;
  const totalParcelas = indeterminado ? null : mesesGerar;
  // Em parcelamento com centavos sobrando, a 1ª parcela é a maior — é o valor de referência.
  const valorParcela = parcelas[0].valor;

  const [contrato] = await prisma.$transaction([
    prisma.contratoReceita.create({
      data: {
        id: contratoId,
        descricao,
        cliente,
        tipo_negocio: tipoNegocio,
        modo: entrada.modo,
        valor_parcela: valorParcela,
        valor_total: entrada.modo === "parcelada" ? Math.round((entrada.valor_total ?? 0) * 100) / 100 : null,
        duracao_meses: totalParcelas,
        dia_vencimento: dia,
        data_inicio: primeiro,
        gerado_ate: parseData(parcelas[parcelas.length - 1].data),
        observacao: entrada.observacao?.trim() || null,
      },
    }),
    prisma.receitaPrevistaMax.createMany({
      data: parcelas.map((p) => ({
        id: randomUUID(),
        descricao: tituloDaParcela(descricao, p.numero, totalParcelas),
        valor: p.valor,
        data_prevista: parseData(p.data)!,
        tipo_negocio: tipoNegocio,
        cliente,
        observacao: entrada.observacao?.trim() || null,
        contrato_id: contratoId,
        parcela_numero: p.numero,
        parcelas_total: totalParcelas,
      })),
    }),
  ]);

  return { contrato, parcelas: parcelas.length };
}

/**
 * Contratos por prazo indeterminado mantêm sempre 12 meses de parcelas à frente.
 * Idempotente e barato — chamado a cada carregamento de receitas/visão geral,
 * então não depende de cron nenhum para as parcelas do mês novo aparecerem.
 */
export async function garantirParcelasContratos(): Promise<number> {
  const contratos = await prisma.contratoReceita.findMany({
    where: { status: "ativo", duracao_meses: null },
  });
  if (contratos.length === 0) return 0;

  const mesAlvo = somarMeses(mesDe(getBrasiliaDateOnly()), JANELA_INDETERMINADO);
  let criadas = 0;

  for (const c of contratos) {
    const max = await prisma.receitaPrevistaMax.aggregate({
      where: { contrato_id: c.id },
      _max: { parcela_numero: true },
    });
    let numero = (max._max.parcela_numero ?? 0) + 1;
    const novas: Array<{ numero: number; data: Date }> = [];

    while (novas.length < 36) {
      const data = vencimentoDaParcela(c.data_inicio, c.dia_vencimento, numero - 1);
      if (mesDe(data) > mesAlvo) break;
      novas.push({ numero, data });
      numero++;
    }
    if (novas.length === 0) continue;

    const res = await prisma.receitaPrevistaMax.createMany({
      data: novas.map((n) => ({
        id: randomUUID(),
        descricao: tituloDaParcela(c.descricao, n.numero, null),
        valor: c.valor_parcela,
        data_prevista: n.data,
        tipo_negocio: c.tipo_negocio,
        cliente: c.cliente,
        observacao: c.observacao,
        contrato_id: c.id,
        parcela_numero: n.numero,
        parcelas_total: null,
      })),
      skipDuplicates: true,
    });
    criadas += res.count;
    await prisma.contratoReceita.update({
      where: { id: c.id },
      data: { gerado_ate: novas[novas.length - 1].data },
    });
  }
  return criadas;
}

/** Encerra o contrato: as parcelas futuras ainda pendentes viram "perdida" (com motivo). */
export async function encerrarContrato(id: string, motivo?: string | null) {
  const contrato = await prisma.contratoReceita.findUnique({ where: { id } });
  if (!contrato) return null;
  if (contrato.status !== "ativo") return { contrato, parcelasPerdidas: 0 };

  const hoje = getBrasiliaDateOnly();
  const [atualizado, perdidas] = await prisma.$transaction([
    prisma.contratoReceita.update({ where: { id }, data: { status: "encerrado" } }),
    prisma.receitaPrevistaMax.updateMany({
      where: { contrato_id: id, status: "pendente", data_prevista: { gt: hoje } },
      data: {
        status: "perdida",
        data_perda: hoje,
        motivo_perda: motivo?.trim() || `Contrato encerrado em ${toISODate(hoje)}`,
      },
    }),
  ]);
  return { contrato: atualizado, parcelasPerdidas: perdidas.count };
}
