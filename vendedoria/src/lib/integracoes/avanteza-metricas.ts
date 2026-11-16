// Métricas agregadas para o painel "Dashboards" da Central Avanteza (somente leitura).
//
// REGRAS DE PRIVACIDADE E ESCOPO (ver docs/integracao-avanteza.md):
// - Só AGREGADOS: contagens, somas, séries diárias. Nenhum nome, telefone, e-mail, texto de conversa ou
//   descrição de lançamento sai daqui (categorias de lançamento e nomes de etapa do funil são rótulos, não pessoas).
// - Financeiro: SÓ o escopo da empresa Avanteza (tipo_negocio "nexo", mais o legado "vendedoria" que a migração
//   do Max renomeia para "nexo"). O pessoal e "outros" (lukaizen/geral) nunca entram. Em ReceitaPrevistaMax vazio
//   significa pessoal, então fica de fora também. O payload declara o escopo usado.
// - Nada aqui escreve no banco: não chama migrações nem a geração de parcelas.
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma/client";
import { tipoEncerramento } from "@/lib/crm/encerramento";
import { getBrasiliaDateOnly } from "@/lib/max/config";
import { parseData, somarDias, toISODate } from "@/lib/finance/periodo";

export const VERSAO_PAYLOAD = 1;
export const MAX_DIAS = 366;
/** Valores de tipo_negocio que pertencem à empresa Avanteza. */
export const TIPOS_AVANTEZA = ["nexo", "vendedoria"] as const;

// ─── Autenticação (tempo constante) ──────────────────────────────────────────

export type ResultadoAuth = "ok" | "sem-chave-configurada" | "nao-autorizado";

/** Compara o Bearer com AVANTEZA_METRICS_KEY. Sem a variável: 503 (nunca "aberto"). */
export function conferirChave(authorization: string | null | undefined, chave: string | undefined): ResultadoAuth {
  if (!chave || !chave.trim()) return "sem-chave-configurada";
  const m = /^Bearer\s+(.+)$/i.exec((authorization ?? "").trim());
  if (!m) return "nao-autorizado";
  // Hash dos dois lados: tamanhos iguais para timingSafeEqual e nada de vazar o comprimento da chave.
  const a = createHash("sha256").update(m[1].trim()).digest();
  const b = createHash("sha256").update(chave.trim()).digest();
  return timingSafeEqual(a, b) ? "ok" : "nao-autorizado";
}

// ─── Período ─────────────────────────────────────────────────────────────────

export interface IntervaloDatas { from: string; to: string }

export function validarIntervalo(from: string | null, to: string | null): { ok: true; de: Date; ate: Date } | { ok: false; erro: string } {
  const de = parseData(from);
  const ate = parseData(to);
  if (!de || !ate) return { ok: false, erro: "informe from e to no formato YYYY-MM-DD" };
  if (de > ate) return { ok: false, erro: "from não pode ser depois de to" };
  const dias = Math.round((ate.getTime() - de.getTime()) / 86_400_000) + 1;
  if (dias > MAX_DIAS) return { ok: false, erro: `período máximo de ${MAX_DIAS} dias` };
  return { ok: true, de, ate };
}

/** Período imediatamente anterior, do mesmo tamanho em dias. */
export function periodoAnteriorDias(de: Date, ate: Date): { de: Date; ate: Date; dias: number } {
  const dias = Math.round((ate.getTime() - de.getTime()) / 86_400_000) + 1;
  const fim = somarDias(de, -1);
  return { de: somarDias(fim, -(dias - 1)), ate: fim, dias };
}

/** Limites em instantes UTC do período em horário de Brasília (UTC-3, sem horário de verão). [início, fim). */
export function limitesBrasilia(de: Date, ate: Date): { gte: Date; lt: Date } {
  return { gte: new Date(de.getTime() + 3 * 3_600_000), lt: new Date(somarDias(ate, 1).getTime() + 3 * 3_600_000) };
}

/** Data (YYYY-MM-DD) em Brasília de um instante. */
export function diaBrasilia(d: Date): string {
  return toISODate(new Date(d.getTime() - 3 * 3_600_000));
}

export function listarDias(de: Date, ate: Date): string[] {
  const out: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) out.push(toISODate(d));
  return out;
}

const arred = (n: number) => Math.round(n * 100) / 100;
const soma = (xs: number[]) => arred(xs.reduce((a, b) => a + b, 0));

// ─── Tipos do payload ────────────────────────────────────────────────────────

export interface PontoDia { data: string; leadsNovos: number; ganhos: number; vendas: number; receitas: number; despesas: number }
export interface BlocoPeriodo {
  periodo: { from: string; to: string; dias: number };
  leads: {
    novos: number;
    /** Distribuição, na etapa em que estão hoje, dos leads criados no período. */
    porEtapa: Array<{ etapa: string; tipo: string; quantidade: number }>;
    ganhos: number;
    perdidos: number;
  };
  conversao: { leadsDaCoorte: number; viraramCliente: number; taxaPct: number | null };
  vendas: { quantidade: number; valor: number; ticketMedio: number | null; comValor: number };
  faturamento: { vendido: number; contratosRecorrentesNovos: number; valorMensalRecorrenteNovo: number; contratosParceladosNovos: number; valorParceladoNovo: number };
  financeiro: {
    receitas: number;
    despesas: number;
    resultado: number;
    receitasPorCategoria: Array<{ categoria: string; valor: number }>;
    despesasPorCategoria: Array<{ categoria: string; valor: number }>;
  };
  series: PontoDia[];
}
export interface MetricasAvanteza {
  versao: number;
  geradoEm: string;
  escopo: { financeiro: "avanteza"; tiposNegocio: string[]; excluido: string[]; comercial: string; observacao: string };
  atual: BlocoPeriodo;
  anterior: BlocoPeriodo;
  previstos: {
    referencia: string;
    aReceber: { total: number; quantidade: number; atrasado: { total: number; quantidade: number }; proximos30: number; proximos60: number; proximos90: number; deContratos: { total: number; quantidade: number } };
    aPagar: { total: number; quantidade: number; atrasado: { total: number; quantidade: number }; proximos30: number; proximos60: number; proximos90: number };
    saldoProjetado30: number;
    saldoProjetado90: number;
  };
  contratos: { ativos: number; recorrentes: number; parcelados: number; valorMensalRecorrente: number; saldoAReceberParcelados: number };
}

// ─── Cálculo de um período ───────────────────────────────────────────────────

const TIPOS_PERDA = ["LOST", "DESCARTADO", "JUNK"];

/** Filtro de organização do comercial: AVANTEZA_METRICS_ORG_ID restringe; vazio = todas as organizações. */
function orgFiltro(env: NodeJS.ProcessEnv): { organizationId?: string } {
  const id = env.AVANTEZA_METRICS_ORG_ID?.trim();
  return id ? { organizationId: id } : {};
}

export async function calcularBloco(de: Date, ate: Date, env: NodeJS.ProcessEnv = process.env): Promise<BlocoPeriodo> {
  const { gte, lt } = limitesBrasilia(de, ate);
  const dias = listarDias(de, ate);
  const org = orgFiltro(env);
  const tipoNeg = { in: [...TIPOS_AVANTEZA] };
  const noDia = { gte: de, lte: ate };

  const [leads, ganhosHist, perdasHist, transacoes, contratos] = await Promise.all([
    prisma.lead.findMany({
      where: { ...org, createdAt: { gte, lt } },
      select: { createdAt: true, kanbanColumn: { select: { name: true, type: true } } },
    }),
    // Negócios que ENTRARAM numa etapa de ganho no período (um por lead, o último registro dentro do período).
    prisma.leadStageHistory.findMany({
      where: { toType: "GANHO", enteredAt: { gte, lt }, ...(org.organizationId ? { lead: { organizationId: org.organizationId } } : {}) },
      select: { leadId: true, enteredAt: true, lead: { select: { valorContrato: true } } },
    }),
    prisma.leadStageHistory.findMany({
      where: { toType: { in: TIPOS_PERDA }, enteredAt: { gte, lt }, ...(org.organizationId ? { lead: { organizationId: org.organizationId } } : {}) },
      select: { leadId: true },
    }),
    prisma.transacao.findMany({
      where: { tipo_negocio: tipoNeg, confirmado: true, data_transacao: noDia, tipo: { in: ["receita", "despesa"] } },
      select: { tipo: true, valor: true, categoria: true, data_transacao: true },
    }),
    prisma.contratoReceita.findMany({
      where: { tipo_negocio: tipoNeg, data_inicio: noDia, status: { not: "cancelado" } },
      select: { modo: true, valor_parcela: true, valor_total: true },
    }),
  ]);

  // Leads novos e distribuição por etapa
  const porEtapaMap = new Map<string, { etapa: string; tipo: string; quantidade: number }>();
  let viraramCliente = 0;
  for (const l of leads) {
    const k = `${l.kanbanColumn.type}|${l.kanbanColumn.name}`;
    const e = porEtapaMap.get(k) ?? { etapa: l.kanbanColumn.name, tipo: l.kanbanColumn.type, quantidade: 0 };
    e.quantidade++;
    porEtapaMap.set(k, e);
    if (tipoEncerramento(l.kanbanColumn.type) === "GANHO") viraramCliente++;
  }

  // Ganhos: um lead conta uma vez (a passagem mais recente por ganho no período)
  const ganhosPorLead = new Map<string, { enteredAt: Date; valor: number | null }>();
  for (const g of ganhosHist) {
    const atual = ganhosPorLead.get(g.leadId);
    if (!atual || g.enteredAt > atual.enteredAt) ganhosPorLead.set(g.leadId, { enteredAt: g.enteredAt, valor: g.lead.valorContrato });
  }
  const ganhos = [...ganhosPorLead.values()];
  const comValor = ganhos.filter((g) => g.valor != null && g.valor > 0);
  const valorVendas = soma(comValor.map((g) => g.valor as number));
  const perdidos = new Set(perdasHist.map((p) => p.leadId)).size;

  // Financeiro
  const catR = new Map<string, number>();
  const catD = new Map<string, number>();
  for (const t of transacoes) {
    const m = t.tipo === "receita" ? catR : catD;
    const c = (t.categoria || "Outros").trim() || "Outros";
    m.set(c, (m.get(c) ?? 0) + t.valor);
  }
  const lista = (m: Map<string, number>) => [...m.entries()].map(([categoria, valor]) => ({ categoria, valor: arred(valor) })).sort((a, b) => b.valor - a.valor);
  const receitas = soma(transacoes.filter((t) => t.tipo === "receita").map((t) => t.valor));
  const despesas = soma(transacoes.filter((t) => t.tipo === "despesa").map((t) => t.valor));

  // Contratos novos
  const rec = contratos.filter((c) => c.modo === "recorrente");
  const par = contratos.filter((c) => c.modo === "parcelada");

  // Séries diárias
  const idx = new Map(dias.map((d, i) => [d, i]));
  const series: PontoDia[] = dias.map((data) => ({ data, leadsNovos: 0, ganhos: 0, vendas: 0, receitas: 0, despesas: 0 }));
  for (const l of leads) { const i = idx.get(diaBrasilia(l.createdAt)); if (i !== undefined) series[i].leadsNovos++; }
  for (const g of ganhos) {
    const i = idx.get(diaBrasilia(g.enteredAt));
    if (i !== undefined) { series[i].ganhos++; series[i].vendas = arred(series[i].vendas + (g.valor && g.valor > 0 ? g.valor : 0)); }
  }
  for (const t of transacoes) {
    const i = idx.get(toISODate(t.data_transacao));
    if (i === undefined) continue;
    if (t.tipo === "receita") series[i].receitas = arred(series[i].receitas + t.valor);
    else series[i].despesas = arred(series[i].despesas + t.valor);
  }

  return {
    periodo: { from: dias[0], to: dias[dias.length - 1], dias: dias.length },
    leads: { novos: leads.length, porEtapa: [...porEtapaMap.values()].sort((a, b) => b.quantidade - a.quantidade), ganhos: ganhos.length, perdidos },
    conversao: { leadsDaCoorte: leads.length, viraramCliente, taxaPct: leads.length ? Math.round((viraramCliente / leads.length) * 1000) / 10 : null },
    vendas: { quantidade: ganhos.length, valor: valorVendas, ticketMedio: comValor.length ? arred(valorVendas / comValor.length) : null, comValor: comValor.length },
    faturamento: {
      vendido: valorVendas,
      contratosRecorrentesNovos: rec.length,
      valorMensalRecorrenteNovo: soma(rec.map((c) => c.valor_parcela)),
      contratosParceladosNovos: par.length,
      valorParceladoNovo: soma(par.map((c) => c.valor_total ?? 0)),
    },
    financeiro: { receitas, despesas, resultado: arred(receitas - despesas), receitasPorCategoria: lista(catR), despesasPorCategoria: lista(catD) },
    series,
  };
}

// ─── Previstos e contratos (retrato de hoje, não dependem do período) ────────

export async function calcularPrevistos(hoje: Date): Promise<MetricasAvanteza["previstos"]> {
  const tipoNeg = { in: [...TIPOS_AVANTEZA] };
  const [receber, pagar] = await Promise.all([
    prisma.receitaPrevistaMax.findMany({
      where: { tipo_negocio: tipoNeg, status: { in: ["pendente", "atrasada"] } },
      select: { valor: true, data_prevista: true, contrato_id: true },
    }),
    prisma.contaPagarMax.findMany({
      where: { tipo_negocio: tipoNeg, status: "pendente" },
      select: { valor: true, data_vencimento: true },
    }),
  ]);
  const ate = (n: number) => somarDias(hoje, n);
  const agrupar = (itens: Array<{ valor: number; data: Date }>) => {
    const futuros = itens.filter((i) => i.data >= hoje);
    const atrasados = itens.filter((i) => i.data < hoje);
    const ateN = (n: number) => soma(futuros.filter((i) => i.data <= ate(n)).map((i) => i.valor));
    return {
      total: soma(futuros.map((i) => i.valor)), quantidade: futuros.length,
      atrasado: { total: soma(atrasados.map((i) => i.valor)), quantidade: atrasados.length },
      proximos30: ateN(30), proximos60: ateN(60), proximos90: ateN(90),
    };
  };
  const r = agrupar(receber.map((x) => ({ valor: x.valor, data: x.data_prevista })));
  const p = agrupar(pagar.map((x) => ({ valor: x.valor, data: x.data_vencimento })));
  const deContrato = receber.filter((x) => x.contrato_id && x.data_prevista >= hoje);
  return {
    referencia: toISODate(hoje),
    aReceber: { ...r, deContratos: { total: soma(deContrato.map((x) => x.valor)), quantidade: deContrato.length } },
    aPagar: p,
    saldoProjetado30: arred(r.proximos30 - p.proximos30),
    saldoProjetado90: arred(r.proximos90 - p.proximos90),
  };
}

export async function calcularContratos(hoje: Date): Promise<MetricasAvanteza["contratos"]> {
  const tipoNeg = { in: [...TIPOS_AVANTEZA] };
  const ativos = await prisma.contratoReceita.findMany({
    where: { tipo_negocio: tipoNeg, status: "ativo" },
    select: { id: true, modo: true, valor_parcela: true },
  });
  const parceladosIds = ativos.filter((c) => c.modo === "parcelada").map((c) => c.id);
  const saldo = parceladosIds.length
    ? await prisma.receitaPrevistaMax.aggregate({
        where: { contrato_id: { in: parceladosIds }, status: { in: ["pendente", "atrasada"] } },
        _sum: { valor: true },
      })
    : { _sum: { valor: 0 } };
  const rec = ativos.filter((c) => c.modo === "recorrente");
  void hoje;
  return {
    ativos: ativos.length,
    recorrentes: rec.length,
    parcelados: parceladosIds.length,
    valorMensalRecorrente: soma(rec.map((c) => c.valor_parcela)),
    saldoAReceberParcelados: arred(saldo._sum.valor ?? 0),
  };
}

export async function calcularMetricas(de: Date, ate: Date, env: NodeJS.ProcessEnv = process.env): Promise<MetricasAvanteza> {
  const ant = periodoAnteriorDias(de, ate);
  const hoje = getBrasiliaDateOnly();
  const [atual, anterior, previstos, contratos] = await Promise.all([
    calcularBloco(de, ate, env), calcularBloco(ant.de, ant.ate, env), calcularPrevistos(hoje), calcularContratos(hoje),
  ]);
  return {
    versao: VERSAO_PAYLOAD,
    geradoEm: new Date().toISOString(),
    escopo: {
      financeiro: "avanteza",
      tiposNegocio: [...TIPOS_AVANTEZA],
      excluido: ["pessoal", "lukaizen", "geral", "receitas previstas sem tipo de negócio"],
      comercial: env.AVANTEZA_METRICS_ORG_ID?.trim() ? "uma organização (AVANTEZA_METRICS_ORG_ID)" : "todas as organizações do Vendedor IA",
      observacao: "Somente agregados. Sem nomes, telefones, e-mails ou conversas. Previstos e contratos são o retrato de hoje.",
    },
    atual, anterior, previstos, contratos,
  };
}
