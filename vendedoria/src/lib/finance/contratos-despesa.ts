// Contratos de despesa: financiamento da Caixa, MRV, parcela do carro, empréstimo do
// Fernando, internet, água e luz. O dono cadastra o contrato uma vez e o sistema gera
// as contas a pagar do mês atual e do seguinte (nada de 388 linhas de uma vez).
// Nada é apagado: contas geradas ficam sempre gravadas e passam pelo livro-razão.
//
// Regras:
//  • Uma conta por parcela e por contrato (contrato_id + parcela_numero é único).
//  • Parcela 0 = entrada. O valor vem do cronograma (se houver) ou de valor_parcela.
//  • Contrato com "estimada" gera contas marcadas como valor aproximado até o dono
//    informar o valor real da fatura.
//  • Se já existe uma conta lançada à mão com o mesmo nome no mesmo mês, não duplica.

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma/client";
import type { ContratoDespesa } from "@prisma/client";
import { getBrasiliaDateOnly } from "@/lib/max/config";
import { chaveCategoria } from "./dre";
import { ErroValidacao } from "./erros";
import { vencimentoDaParcela } from "./parcelas";
import { mesDe, parseData, primeiroDiaDoMes, somarMeses, toISODate, ultimoDiaDoMes } from "./periodo";

export const MAX_PARCELAS_CONTRATO = 600;
const POR_RODADA = 24;
const TIPOS_NEGOCIO = ["pessoal", "nexo", "lukaizen", "geral"];

export type Cronograma = Record<string, number>;

export interface NovoContratoDespesa {
  descricao: string;
  credor?: string | null;
  categoria?: string | null;
  tipo_negocio?: string | null;
  valor_parcela: number;
  /** vazio = sem fim */
  parcelas_total?: number | null;
  dia_vencimento?: number;
  /** vencimento da parcela 1 (YYYY-MM-DD) */
  primeiro_vencimento: string;
  entrada?: number | null;
  entrada_data?: string | null;
  saldo_devedor?: number | null;
  estimada?: boolean;
  cronograma?: Cronograma | null;
  observacao?: string | null;
}

const arred = (n: number) => Math.round(n * 100) / 100;

// ─── Funções puras ─────────────────────────────────────────────────────────────

export function valorDaParcela(c: Pick<ContratoDespesa, "valor_parcela" | "entrada" | "cronograma">, numero: number): number {
  if (numero === 0) return arred(c.entrada ?? 0);
  const cron = (c.cronograma ?? null) as Cronograma | null;
  const v = cron?.[String(numero)];
  return arred(typeof v === "number" ? v : c.valor_parcela);
}

export function vencimentoDeParcela(c: Pick<ContratoDespesa, "data_inicio" | "dia_vencimento" | "entrada_data">, numero: number): Date {
  if (numero === 0 && c.entrada_data) return c.entrada_data;
  return vencimentoDaParcela(c.data_inicio, c.dia_vencimento, Math.max(0, numero - 1));
}

export function descricaoDaConta(c: Pick<ContratoDespesa, "descricao" | "parcelas_total">, numero: number): string {
  if (numero === 0) return `${c.descricao} — entrada`;
  return c.parcelas_total ? `${c.descricao} — parcela ${numero}/${c.parcelas_total}` : c.descricao;
}

export interface ParcelaPrevista { numero: number; vencimento: Date; valor: number }

/** Parcelas que devem existir entre os meses informados (inclusive), das que ainda faltam gerar. */
export function parcelasDoPeriodo(
  c: Pick<ContratoDespesa, "valor_parcela" | "entrada" | "entrada_data" | "cronograma" | "data_inicio" | "dia_vencimento" | "parcelas_total">,
  mesMin: string,
  mesMax: string,
): ParcelaPrevista[] {
  const out: ParcelaPrevista[] = [];
  if (c.entrada != null && c.entrada > 0 && c.entrada_data) {
    const m = mesDe(c.entrada_data);
    if (m >= mesMin && m <= mesMax) out.push({ numero: 0, vencimento: c.entrada_data, valor: valorDaParcela(c, 0) });
  }
  // Pula direto para perto do mês mínimo (contratos longos, ex.: 388 parcelas).
  const [y0, m0] = mesDe(c.data_inicio).split("-").map(Number);
  const [y1, m1] = mesMin.split("-").map(Number);
  let n = Math.max(1, (y1 - y0) * 12 + (m1 - m0));
  for (; out.length < 200; n++) {
    if (c.parcelas_total != null && n > c.parcelas_total) break;
    const v = vencimentoDaParcela(c.data_inicio, c.dia_vencimento, n - 1);
    const m = mesDe(v);
    if (m > mesMax) break;
    if (m < mesMin) continue;
    out.push({ numero: n, vencimento: v, valor: valorDaParcela(c, n) });
  }
  return out;
}

function validarCronograma(cr: unknown, total: number | null): Cronograma | null {
  if (cr == null) return null;
  if (typeof cr !== "object" || Array.isArray(cr)) throw new ErroValidacao("Cronograma inválido.");
  const out: Cronograma = {};
  for (const [k, v] of Object.entries(cr as Record<string, unknown>)) {
    const n = Number(k);
    const val = Number(v);
    if (!Number.isInteger(n) || n < 1 || (total != null && n > total)) throw new ErroValidacao(`Cronograma: parcela ${k} fora do contrato.`);
    if (!Number.isFinite(val) || val <= 0) throw new ErroValidacao(`Cronograma: valor da parcela ${k} inválido.`);
    out[String(n)] = arred(val);
  }
  return Object.keys(out).length ? out : null;
}

export function validarNovoContrato(e: NovoContratoDespesa) {
  const descricao = e.descricao?.trim();
  if (!descricao) throw new ErroValidacao("Informe o nome do contrato.");
  const valor = Number(e.valor_parcela);
  if (!Number.isFinite(valor) || valor <= 0) throw new ErroValidacao("Informe um valor de parcela maior que zero.");
  const primeiro = parseData(e.primeiro_vencimento);
  if (!primeiro) throw new ErroValidacao("Data do primeiro vencimento inválida.");
  const dia = e.dia_vencimento ?? primeiro.getUTCDate();
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) throw new ErroValidacao("O dia de vencimento deve ficar entre 1 e 31.");
  let total: number | null = null;
  if (e.parcelas_total != null && String(e.parcelas_total) !== "") {
    total = Number(e.parcelas_total);
    if (!Number.isInteger(total) || total < 1 || total > MAX_PARCELAS_CONTRATO) {
      throw new ErroValidacao(`A quantidade de parcelas deve ficar entre 1 e ${MAX_PARCELAS_CONTRATO} (ou vazia, para sem fim).`);
    }
  }
  const tipo = (e.tipo_negocio ?? "pessoal").trim() || "pessoal";
  if (!TIPOS_NEGOCIO.includes(tipo)) throw new ErroValidacao("Negócio inválido.");
  let entrada: number | null = null;
  let entradaData: Date | null = null;
  if (e.entrada != null && Number(e.entrada) > 0) {
    entrada = arred(Number(e.entrada));
    entradaData = parseData(e.entrada_data ?? null);
    if (!entradaData) throw new ErroValidacao("Informe a data de vencimento da entrada.");
  }
  const saldo = e.saldo_devedor != null && Number(e.saldo_devedor) > 0 ? arred(Number(e.saldo_devedor)) : null;
  return {
    descricao,
    credor: e.credor?.trim() || null,
    categoria: e.categoria?.trim() || "Outros",
    tipo_negocio: tipo,
    valor_parcela: arred(valor),
    parcelas_total: total,
    dia_vencimento: dia,
    data_inicio: primeiro,
    entrada,
    entrada_data: entradaData,
    saldo_devedor: saldo,
    estimada: Boolean(e.estimada),
    cronograma: validarCronograma(e.cronograma, total),
    observacao: e.observacao?.trim() || null,
  };
}

// ─── Banco ─────────────────────────────────────────────────────────────────────

async function gerarDoContrato(c: ContratoDespesa, mesAtual: string, mesLimite: string): Promise<number> {
  const previstas = parcelasDoPeriodo(c, mesAtual, mesLimite);
  if (previstas.length === 0) return 0;

  const existentes = new Set(
    (await prisma.contaPagarMax.findMany({ where: { contrato_id: c.id }, select: { parcela_numero: true } }))
      .map((x) => x.parcela_numero),
  );
  // Conta lançada à mão (antes do contrato) com o mesmo nome no mesmo mês: não duplica.
  // Ela é ADOTADA pelo contrato (ganha o número da parcela), para o progresso contar quando for paga.
  const nomeContrato = chaveCategoria(c.descricao);
  const manuais = await prisma.contaPagarMax.findMany({
    where: {
      contrato_id: null, status: { in: ["pendente", "paga"] },
      data_vencimento: { gte: primeiroDiaDoMes(mesAtual), lte: ultimoDiaDoMes(mesLimite) },
    },
    orderBy: { data_vencimento: "asc" },
    select: { id: true, descricao: true, data_vencimento: true },
  });
  const manualDoMes = new Map<string, string>(); // mês → id da conta lançada à mão
  for (const m of manuais) {
    const mes = mesDe(m.data_vencimento);
    if (!manualDoMes.has(mes) && chaveCategoria(m.descricao).startsWith(nomeContrato)) manualDoMes.set(mes, m.id);
  }

  let adotadas = 0;
  const novas: ParcelaPrevista[] = [];
  for (const p of previstas) {
    if (existentes.has(p.numero)) continue;
    const idManual = manualDoMes.get(mesDe(p.vencimento));
    if (idManual) {
      await prisma.contaPagarMax.update({
        where: { id: idManual },
        data: { contrato_id: c.id, parcela_numero: p.numero, parcelas_total: c.parcelas_total },
      }).then(() => { adotadas++; }).catch(() => {}); // número já ocupado por corrida: deixa para a próxima rodada
      continue;
    }
    if (novas.length < POR_RODADA) novas.push(p);
  }
  if (novas.length === 0) return adotadas;

  const res = await prisma.contaPagarMax.createMany({
    data: novas.map((p) => ({
      id: randomUUID(),
      descricao: descricaoDaConta(c, p.numero),
      valor: p.valor,
      data_vencimento: p.vencimento,
      categoria: c.categoria,
      tipo_negocio: c.tipo_negocio,
      recorrente: false,
      contrato_id: c.id,
      parcela_numero: p.numero,
      parcelas_total: c.parcelas_total,
      estimada: c.estimada && p.numero !== 0,
    })),
    skipDuplicates: true,
  });
  return res.count + adotadas;
}

/** Gera as contas do mês atual e do seguinte para todos os contratos ativos. Idempotente. */
export async function garantirContasDeContratos(hoje: Date = getBrasiliaDateOnly()): Promise<number> {
  const contratos = await prisma.contratoDespesa.findMany({ where: { status: "ativo" } });
  if (contratos.length === 0) return 0;
  const mesAtual = mesDe(hoje);
  const mesLimite = somarMeses(mesAtual, 1);
  let criadas = 0;
  for (const c of contratos) criadas += await gerarDoContrato(c, mesAtual, mesLimite);
  return criadas;
}

export async function criarContratoDespesa(entrada: NovoContratoDespesa) {
  const dados = validarNovoContrato(entrada);
  const duplicado = await prisma.contratoDespesa.findFirst({
    where: { status: "ativo", descricao: { equals: dados.descricao, mode: "insensitive" } },
    select: { id: true },
  });
  if (duplicado) throw new ErroValidacao(`Já existe um contrato ativo chamado "${dados.descricao}".`);
  const contrato = await prisma.contratoDespesa.create({
    data: { ...dados, cronograma: dados.cronograma ?? undefined },
  });
  const geradas = await garantirContasDeContratos();
  return { contrato, geradas };
}

export interface ContratoComProgresso extends ContratoDespesa {
  pagas: number;
  pendentes: number;
  /** parcelas que ainda faltam pagar (null em contrato sem fim) */
  restantes: number | null;
  /** soma do que falta pagar, pelo cronograma (null em contrato sem fim) */
  valor_restante: number | null;
  proxima: { vencimento: string; valor: number; numero: number } | null;
}

export async function listarContratosDespesa(): Promise<ContratoComProgresso[]> {
  const contratos = await prisma.contratoDespesa.findMany({ orderBy: [{ status: "asc" }, { descricao: "asc" }] });
  const contas = await prisma.contaPagarMax.groupBy({
    by: ["contrato_id", "status"],
    where: { contrato_id: { not: null }, parcela_numero: { gt: 0 } }, // a entrada não conta como parcela
    _count: { _all: true },
  });
  const proximas = await prisma.contaPagarMax.findMany({
    where: { contrato_id: { not: null }, status: "pendente" },
    orderBy: { data_vencimento: "asc" },
    select: { contrato_id: true, data_vencimento: true, valor: true, parcela_numero: true },
  });
  const proxPorContrato = new Map<string, (typeof proximas)[number]>();
  for (const p of proximas) if (p.contrato_id && !proxPorContrato.has(p.contrato_id)) proxPorContrato.set(p.contrato_id, p);

  return contratos.map((c) => {
    const conta = (s: string) => contas.find((x) => x.contrato_id === c.id && x.status === s)?._count._all ?? 0;
    const pagas = conta("paga");
    const pendentes = conta("pendente");
    const restantes = c.parcelas_total != null ? Math.max(0, c.parcelas_total - pagas) : null;
    let valorRestante: number | null = null;
    if (c.parcelas_total != null) {
      valorRestante = 0;
      for (let n = 1; n <= c.parcelas_total; n++) valorRestante += valorDaParcela(c, n);
      // Desconta o que já foi pago (valor de referência das parcelas pagas).
      for (let n = 1; n <= pagas; n++) valorRestante -= valorDaParcela(c, n);
      valorRestante = arred(Math.max(0, valorRestante));
    }
    const p = proxPorContrato.get(c.id);
    return {
      ...c, pagas, pendentes, restantes, valor_restante: valorRestante,
      proxima: p ? { vencimento: toISODate(p.data_vencimento), valor: p.valor, numero: p.parcela_numero ?? 0 } : null,
    };
  });
}

export type EdicaoContrato = Partial<Pick<NovoContratoDespesa, "descricao" | "credor" | "categoria" | "tipo_negocio" | "valor_parcela" | "saldo_devedor" | "estimada" | "observacao">>;

/** Edita o contrato; o novo valor da parcela vale para as contas pendentes que ainda estavam no valor antigo. */
export async function editarContratoDespesa(id: string, e: EdicaoContrato) {
  const c = await prisma.contratoDespesa.findUnique({ where: { id } });
  if (!c) throw new ErroValidacao("Contrato não encontrado.");
  const data: Record<string, unknown> = {};
  if (e.descricao !== undefined) {
    const d = String(e.descricao).trim();
    if (!d) throw new ErroValidacao("Informe o nome do contrato.");
    data.descricao = d;
  }
  if (e.credor !== undefined) data.credor = String(e.credor ?? "").trim() || null;
  if (e.categoria !== undefined) data.categoria = String(e.categoria).trim() || "Outros";
  if (e.tipo_negocio !== undefined) {
    if (!TIPOS_NEGOCIO.includes(String(e.tipo_negocio))) throw new ErroValidacao("Negócio inválido.");
    data.tipo_negocio = String(e.tipo_negocio);
  }
  if (e.estimada !== undefined) data.estimada = Boolean(e.estimada);
  if (e.observacao !== undefined) data.observacao = String(e.observacao ?? "").trim() || null;
  if (e.saldo_devedor !== undefined) data.saldo_devedor = e.saldo_devedor != null && Number(e.saldo_devedor) > 0 ? arred(Number(e.saldo_devedor)) : null;
  let valorNovo: number | null = null;
  if (e.valor_parcela !== undefined) {
    const v = Number(e.valor_parcela);
    if (!Number.isFinite(v) || v <= 0) throw new ErroValidacao("Informe um valor de parcela maior que zero.");
    valorNovo = arred(v);
    data.valor_parcela = valorNovo;
  }
  if (Object.keys(data).length === 0) throw new ErroValidacao("Nada para alterar.");

  const atualizado = await prisma.contratoDespesa.update({ where: { id }, data });
  if (valorNovo != null && valorNovo !== c.valor_parcela) {
    // Só o que ainda está no valor antigo e sem cronograma próprio.
    const cron = (c.cronograma ?? {}) as Cronograma;
    await prisma.contaPagarMax.updateMany({
      where: { contrato_id: id, status: "pendente", valor: c.valor_parcela, parcela_numero: { notIn: Object.keys(cron).map(Number) } },
      data: { valor: valorNovo },
    });
  }
  if (e.categoria !== undefined || e.tipo_negocio !== undefined) {
    await prisma.contaPagarMax.updateMany({
      where: { contrato_id: id, status: "pendente" },
      data: { ...(e.categoria !== undefined ? { categoria: String(data.categoria) } : {}), ...(e.tipo_negocio !== undefined ? { tipo_negocio: String(data.tipo_negocio) } : {}) },
    });
  }
  return atualizado;
}

/** Encerra o contrato: para de gerar contas e cancela as pendentes que ainda não venceram. Nada é apagado. */
export async function encerrarContratoDespesa(id: string, hoje: Date = getBrasiliaDateOnly()) {
  const c = await prisma.contratoDespesa.findUnique({ where: { id }, select: { id: true } });
  if (!c) throw new ErroValidacao("Contrato não encontrado.");
  await prisma.contratoDespesa.update({ where: { id }, data: { status: "encerrado" } });
  const canceladas = await prisma.contaPagarMax.updateMany({
    where: { contrato_id: id, status: "pendente", data_vencimento: { gt: hoje } },
    data: { status: "cancelada" },
  });
  return { canceladas: canceladas.count };
}

export async function reativarContratoDespesa(id: string) {
  const c = await prisma.contratoDespesa.findUnique({ where: { id }, select: { id: true } });
  if (!c) throw new ErroValidacao("Contrato não encontrado.");
  await prisma.contratoDespesa.update({ where: { id }, data: { status: "ativo" } });
  return garantirContasDeContratos();
}
