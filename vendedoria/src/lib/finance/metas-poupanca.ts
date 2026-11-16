// Metas de poupança (MetaFinanceiraMax com tipo "poupanca"): quanto guardar por dia,
// até quando e quanto já foi guardado. O dinheiro guardado fica em AporteMetaMax —
// não é despesa, então não entra no DRE nem nos limites de gasto.
//
// valor_atual da meta é sempre a soma dos aportes (recalculada a cada aporte), então
// apagar ou corrigir um aporte nunca deixa o total errado.

import { prisma } from "@/lib/prisma/client";

export const TIPO_POUPANCA = "poupanca";
const DIA_MS = 86_400_000;

/** Hoje em Brasília como meia-noite UTC (mesmo formato das colunas @db.Date). */
export function hojeBrasilia(agora: Date = new Date()): Date {
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  return new Date(`${dia}T00:00:00Z`);
}

export function dataISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const arred = (v: number) => Math.round(v * 100) / 100;

export interface EntradaProjecao {
  alvo: number;
  /** Total guardado até agora (inclui o saldo inicial). */
  atual: number;
  aporteDiario: number;
  dataInicio: Date;
  dataFim: Date;
  hoje: Date;
  /** Guardado hoje (sem contar o saldo inicial). */
  guardadoHoje: number;
  /** Guardado de dataInicio até ontem (sem contar o saldo inicial). */
  guardadoAteOntem: number;
}

export interface Projecao {
  falta: number;
  pct: number;
  /** Dias com aporte ainda por fazer até o prazo, contando hoje se o aporte de hoje não foi completado. */
  diasRestantes: number;
  /** Quanto falta guardar hoje para cumprir o valor diário. */
  pendenteHoje: number;
  /** Diferença acumulada entre o combinado e o guardado nos dias anteriores. */
  atraso: number;
  /** Onde o total chega no prazo mantendo o valor diário. */
  projetadoNoPrazo: number;
  /** Valor por dia que bate a meta no prazo a partir de agora. */
  necessarioPorDia: number;
  vaiBater: boolean;
  concluida: boolean;
}

export function projetarMeta(e: EntradaProjecao): Projecao {
  const falta = Math.max(0, arred(e.alvo - e.atual));
  const pct = e.alvo > 0 ? Math.min(100, Math.round((e.atual / e.alvo) * 1000) / 10) : 0;
  const pendenteHoje = Math.max(0, arred(e.aporteDiario - e.guardadoHoje));
  const diasAteFim = Math.floor((e.dataFim.getTime() - e.hoje.getTime()) / DIA_MS) + 1; // inclui hoje
  const diasRestantes = Math.max(0, diasAteFim - (pendenteHoje > 0 ? 0 : 1));
  const diasPassados = Math.max(0, Math.floor((e.hoje.getTime() - e.dataInicio.getTime()) / DIA_MS));
  const atraso = Math.max(0, arred(e.aporteDiario * diasPassados - e.guardadoAteOntem));
  const projetadoNoPrazo = arred(e.atual + pendenteHoje + e.aporteDiario * Math.max(0, diasRestantes - (pendenteHoje > 0 ? 1 : 0)));
  const necessarioPorDia = falta === 0 ? 0 : diasRestantes > 0 ? Math.ceil(falta / diasRestantes) : falta;
  return {
    falta,
    pct,
    diasRestantes,
    pendenteHoje,
    atraso,
    projetadoNoPrazo,
    necessarioPorDia,
    vaiBater: projetadoNoPrazo >= e.alvo,
    concluida: falta === 0,
  };
}

export interface MetaPoupanca {
  id: string;
  descricao: string;
  alvo: number;
  atual: number;
  aporteDiario: number;
  cobrarDiariamente: boolean;
  chavePix: string | null;
  dataInicio: string;
  dataFim: string;
  status: string;
  projecao: Projecao;
  ultimosAportes: Array<{ id: string; valor: number; data: string; origem: string; observacao: string | null }>;
}

type MetaDb = Awaited<ReturnType<typeof prisma.metaFinanceiraMax.findFirstOrThrow>>;

async function montarMeta(meta: MetaDb, hoje: Date): Promise<MetaPoupanca> {
  const aportes = await prisma.aporteMetaMax.findMany({ where: { meta_id: meta.id }, orderBy: [{ data: "desc" }, { criado_em: "desc" }] });
  const atual = arred(aportes.reduce((a, x) => a + x.valor, 0));
  const dataInicio = meta.data_inicio ?? hoje;
  const dataFim = meta.data_fim ?? hoje;
  const doDia = aportes.filter((a) => a.origem !== "inicial");
  const guardadoHoje = arred(doDia.filter((a) => a.data.getTime() === hoje.getTime()).reduce((s, a) => s + a.valor, 0));
  const guardadoAteOntem = arred(
    doDia.filter((a) => a.data.getTime() < hoje.getTime() && a.data.getTime() >= dataInicio.getTime()).reduce((s, a) => s + a.valor, 0),
  );
  return {
    id: meta.id,
    descricao: meta.descricao,
    alvo: meta.valor_alvo,
    atual,
    aporteDiario: meta.aporte_diario ?? 0,
    cobrarDiariamente: meta.cobrar_diariamente,
    chavePix: meta.chave_pix ?? null,
    dataInicio: dataISO(dataInicio),
    dataFim: dataISO(dataFim),
    status: meta.status,
    projecao: projetarMeta({
      alvo: meta.valor_alvo,
      atual,
      aporteDiario: meta.aporte_diario ?? 0,
      dataInicio,
      dataFim,
      hoje,
      guardadoHoje,
      guardadoAteOntem,
    }),
    ultimosAportes: aportes.slice(0, 10).map((a) => ({ id: a.id, valor: a.valor, data: dataISO(a.data), origem: a.origem, observacao: a.observacao })),
  };
}

export async function listarMetasPoupanca(opts: { agora?: Date; incluirEncerradas?: boolean } = {}): Promise<MetaPoupanca[]> {
  const hoje = hojeBrasilia(opts.agora);
  const metas = await prisma.metaFinanceiraMax.findMany({
    where: { tipo: TIPO_POUPANCA, ...(opts.incluirEncerradas ? {} : { status: "ativa" }) },
    orderBy: { criado_em: "asc" },
  });
  return Promise.all(metas.map((m) => montarMeta(m, hoje)));
}

export async function obterMetaPoupanca(id: string, agora?: Date): Promise<MetaPoupanca | null> {
  const meta = await prisma.metaFinanceiraMax.findUnique({ where: { id } });
  if (!meta || meta.tipo !== TIPO_POUPANCA) return null;
  return montarMeta(meta, hojeBrasilia(agora));
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Acha a meta ativa pelo nome (parcial, sem acento); sem nome, a única/primeira ativa. */
export async function acharMetaPoupanca(nome?: string | null): Promise<MetaDb | null> {
  const ativas = await prisma.metaFinanceiraMax.findMany({ where: { tipo: TIPO_POUPANCA, status: "ativa" }, orderBy: { criado_em: "asc" } });
  if (ativas.length === 0) return null;
  if (!nome?.trim()) return ativas[0];
  const alvo = semAcento(nome.trim());
  return ativas.find((m) => semAcento(m.descricao).includes(alvo)) ?? ativas[0];
}

async function recalcularValorAtual(metaId: string): Promise<number> {
  const soma = await prisma.aporteMetaMax.aggregate({ where: { meta_id: metaId }, _sum: { valor: true } });
  const total = arred(soma._sum.valor ?? 0);
  const meta = await prisma.metaFinanceiraMax.findUnique({ where: { id: metaId }, select: { valor_alvo: true, status: true } });
  await prisma.metaFinanceiraMax.update({
    where: { id: metaId },
    data: {
      valor_atual: total,
      // Bateu a meta: marca como concluída (continua visível; reabre se houver retirada).
      ...(meta && total >= meta.valor_alvo && meta.status === "ativa" ? { status: "concluida" } : {}),
      ...(meta && total < meta.valor_alvo && meta.status === "concluida" ? { status: "ativa" } : {}),
    },
  });
  return total;
}

export async function registrarAporte(input: {
  metaId: string;
  valor: number;
  data?: Date;
  origem?: "max" | "tela" | "inicial";
  observacao?: string | null;
}): Promise<{ aporteId: string; total: number }> {
  const valor = arred(input.valor);
  if (!Number.isFinite(valor) || valor === 0) throw new Error("Valor do aporte inválido.");
  const aporte = await prisma.aporteMetaMax.create({
    data: {
      meta_id: input.metaId,
      valor,
      data: input.data ?? hojeBrasilia(),
      origem: input.origem ?? "max",
      observacao: input.observacao?.trim() || null,
    },
  });
  const total = await recalcularValorAtual(input.metaId);
  return { aporteId: aporte.id, total };
}

export async function excluirAporte(aporteId: string): Promise<{ total: number } | null> {
  const aporte = await prisma.aporteMetaMax.findUnique({ where: { id: aporteId } });
  if (!aporte) return null;
  await prisma.aporteMetaMax.delete({ where: { id: aporteId } });
  return { total: await recalcularValorAtual(aporte.meta_id) };
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const brl = (v: number) => BRL.format(v);
const dataBR = (iso: string) => iso.split("-").reverse().join("/");

/** Resumo em texto (Max e cobrança diária). */
export function resumoMeta(m: MetaPoupanca): string {
  const p = m.projecao;
  if (p.concluida) return `🎉 ${m.descricao}: meta batida! ${brl(m.atual)} de ${brl(m.alvo)}.`;
  const linhas = [
    `${m.descricao}: ${brl(m.atual)} de ${brl(m.alvo)} (${p.pct.toLocaleString("pt-BR")}%) — prazo ${dataBR(m.dataFim)}.`,
    `Faltam ${brl(p.falta)} em ${p.diasRestantes} dias.`,
  ];
  if (m.aporteDiario > 0) {
    linhas.push(
      p.vaiBater
        ? `No ritmo de ${brl(m.aporteDiario)}/dia você chega lá ✅`
        : `⚠️ No ritmo de ${brl(m.aporteDiario)}/dia você chega a ${brl(p.projetadoNoPrazo)} no prazo. Para bater a meta seriam ${brl(p.necessarioPorDia)}/dia.`,
    );
  }
  if (p.atraso > 0) linhas.push(`Atrasado dos dias anteriores: ${brl(p.atraso)}.`);
  return linhas.join("\n");
}
