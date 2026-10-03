// Consulta genérica e somente leitura a TODOS os modelos do app, para o MCP.
// A lista de modelos vem do próprio Prisma (nada fica de fora quando o schema
// cresce). Segurança: modelos de credenciais são bloqueados e qualquer campo
// com cara de segredo (senha, token, chave, hash…) nunca é devolvido nem
// aceito em filtros. Só passa por aqui o que é escalar — sem relações.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";

export const LIMITE_MAX = 100;
const LIMITE_PADRAO = 50;
const TEXTO_MAX = 600;

const MODELOS_BLOQUEADOS = new Set([
  "Account", "Session", "VerificationToken", "ApiKey", "IntegrationCredential", "PushSubscription",
]);
const CAMPO_SECRETO = /(password|senha|secret|token|hash|api_?key|credential|authorization|private)/i;

const AREAS: Record<string, string[]> = {
  "Financeiro": [
    "Transacao", "ReceitaPrevistaMax", "ContratoReceita", "ContaPagarMax", "DividaMax",
    "MetaFinanceiraMax", "OrcamentoMax", "HistoricoFinanceiro", "TarefaMax", "LembreteMax",
    "FinancialProfile", "FinancialAccount", "FinancialCategory", "FinancialTransaction",
    "RecurringBill", "InstallmentPlan",
  ],
  "Prospecção": ["ProspectSegment", "SourcingRun", "ProspectLead", "TemplateProspeccao", "DisparoConfig", "DisparoJob"],
  "CRM / Leads": ["Lead", "KanbanColumn", "LeadActivity", "LeadEscalation", "LeadNote", "Tag", "LeadTag", "ClientDiagnosis", "DeliveryCard"],
  "Conversas": ["WhatsappConversation", "WhatsappMessage", "ConversationFollowUp", "ConversationTag", "OwnerNotification"],
  "Campanhas": ["Campaign", "CampaignRecipient"],
  "Agenda": ["CalendarEvent", "CalendarAttendee", "CalendarReminder", "ProfissionalEntity", "ProfissionalAvailability", "WorkUnitEntity", "ProfissionalWorkProfile"],
  "Vendas / Produtos": ["Product", "Produto", "PedidoNacional", "CotacaoFrete", "Checkout", "OfertaGerada"],
  "Agente IA": ["Agent", "AgentScriptVersion", "AgentConfigVersion", "AgentConfig", "AgentPromptHistory", "AiConfig", "DecisionLog", "PersonalityProfile", "StrategyProfile", "ObjectionRule", "ConstraintRule"],
  "Organização": ["WhatsappBusinessOrganization", "OrgHierarchyItem", "User"],
};

type Campo = { name: string; type: string; kind: string; isList: boolean };
const modelos = new Map<string, Campo[]>();
for (const m of Prisma.dmmf.datamodel.models) {
  if (MODELOS_BLOQUEADOS.has(m.name)) continue;
  modelos.set(
    m.name,
    m.fields
      .filter((f) => (f.kind === "scalar" || f.kind === "enum") && !f.isList && !CAMPO_SECRETO.test(f.name))
      .map((f) => ({ name: f.name, type: f.type, kind: f.kind, isList: f.isList })),
  );
}

function delegate(modelo: string) {
  const d = (prisma as unknown as Record<string, unknown>)[modelo.charAt(0).toLowerCase() + modelo.slice(1)];
  return d as {
    findMany: (a: unknown) => Promise<Record<string, unknown>[]>;
    count: (a: unknown) => Promise<number>;
    groupBy: (a: unknown) => Promise<Record<string, unknown>[]>;
  };
}

function campos(modelo: string): Campo[] {
  const c = modelos.get(modelo);
  if (!c) {
    throw new Error(`Modelo "${modelo}" não existe ou não é consultável. Use listar_modelos para ver os disponíveis.`);
  }
  return c;
}

export function listarModelos() {
  const usados = new Set<string>();
  const areas = Object.entries(AREAS).map(([area, nomes]) => ({
    area,
    modelos: nomes.filter((n) => modelos.has(n)).map((n) => {
      usados.add(n);
      return { modelo: n, campos: modelos.get(n)!.map((f) => `${f.name}:${f.type}`) };
    }),
  }));
  const outros = [...modelos.keys()].filter((n) => !usados.has(n));
  if (outros.length) {
    areas.push({ area: "Outros", modelos: outros.map((n) => ({ modelo: n, campos: modelos.get(n)!.map((f) => `${f.name}:${f.type}`) })) });
  }
  return { areas };
}

export interface Filtro { campo: string; op: string; valor?: unknown }
const OPS = ["igual", "diferente", "contem", "maior", "maior_igual", "menor", "menor_igual", "em", "nulo", "nao_nulo"] as const;
export const OPERADORES = OPS;

function converter(c: Campo, v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (c.type === "DateTime") {
    const d = new Date(String(v));
    if (isNaN(d.getTime())) throw new Error(`Data inválida para ${c.name}: ${String(v)} (use AAAA-MM-DD).`);
    return d;
  }
  if (c.type === "Int" || c.type === "BigInt") return Number(v);
  if (c.type === "Float" || c.type === "Decimal") return Number(v);
  if (c.type === "Boolean") return v === true || v === "true";
  return String(v);
}

function montarWhere(modelo: string, filtros: Filtro[] = []) {
  const cs = campos(modelo);
  const and: Record<string, unknown>[] = [];
  for (const f of filtros) {
    const c = cs.find((x) => x.name === f.campo);
    if (!c) throw new Error(`Campo "${f.campo}" não existe em ${modelo}. Campos: ${cs.map((x) => x.name).join(", ")}`);
    const nome = c.name;
    switch (f.op) {
      case "igual": and.push({ [nome]: converter(c, f.valor) }); break;
      case "diferente": and.push({ [nome]: { not: converter(c, f.valor) } }); break;
      case "contem": and.push({ [nome]: { contains: String(f.valor ?? ""), mode: "insensitive" } }); break;
      case "maior": and.push({ [nome]: { gt: converter(c, f.valor) } }); break;
      case "maior_igual": and.push({ [nome]: { gte: converter(c, f.valor) } }); break;
      case "menor": and.push({ [nome]: { lt: converter(c, f.valor) } }); break;
      case "menor_igual": and.push({ [nome]: { lte: converter(c, f.valor) } }); break;
      case "em": and.push({ [nome]: { in: (Array.isArray(f.valor) ? f.valor : [f.valor]).map((x) => converter(c, x)) } }); break;
      case "nulo": and.push({ [nome]: null }); break;
      case "nao_nulo": and.push({ [nome]: { not: null } }); break;
      default: throw new Error(`Operador "${f.op}" inválido. Use: ${OPS.join(", ")}`);
    }
  }
  return and.length ? { AND: and } : {};
}

function enxugar(linha: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(linha)) {
    if (typeof v === "string" && v.length > TEXTO_MAX) out[k] = v.slice(0, TEXTO_MAX) + "…";
    else if (typeof v === "bigint") out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}

export async function consultar(p: {
  modelo: string; filtros?: Filtro[]; campos?: string[]; ordenar_por?: string; direcao?: "asc" | "desc"; limite?: number; pular?: number;
}) {
  const cs = campos(p.modelo);
  const where = montarWhere(p.modelo, p.filtros);
  const limite = Math.min(Math.max(p.limite ?? LIMITE_PADRAO, 1), LIMITE_MAX);
  const escolhidos = p.campos?.length ? p.campos : cs.map((c) => c.name);
  for (const n of escolhidos) if (!cs.some((c) => c.name === n)) throw new Error(`Campo "${n}" não existe em ${p.modelo}.`);
  const ordem = p.ordenar_por ?? (cs.some((c) => c.name === "criado_em") ? "criado_em" : cs.some((c) => c.name === "createdAt") ? "createdAt" : undefined);
  if (ordem && !cs.some((c) => c.name === ordem)) throw new Error(`Campo de ordenação "${ordem}" não existe em ${p.modelo}.`);
  const d = delegate(p.modelo);
  const [total, linhas] = await Promise.all([
    d.count({ where }),
    d.findMany({
      where,
      select: Object.fromEntries(escolhidos.map((n) => [n, true])),
      ...(ordem ? { orderBy: { [ordem]: p.direcao ?? "desc" } } : {}),
      take: limite,
      skip: Math.max(p.pular ?? 0, 0),
    }),
  ]);
  return { modelo: p.modelo, total, retornados: linhas.length, limite, registros: linhas.map(enxugar) };
}

export async function agregar(p: { modelo: string; filtros?: Filtro[]; somar?: string; agrupar_por?: string[] }) {
  const cs = campos(p.modelo);
  const where = montarWhere(p.modelo, p.filtros);
  const d = delegate(p.modelo);
  if (p.somar) {
    const c = cs.find((x) => x.name === p.somar);
    if (!c || !["Int", "Float", "Decimal", "BigInt"].includes(c.type)) throw new Error(`"${p.somar}" não é um campo numérico de ${p.modelo}.`);
  }
  for (const g of p.agrupar_por ?? []) if (!cs.some((c) => c.name === g)) throw new Error(`Campo de agrupamento "${g}" não existe em ${p.modelo}.`);
  if (!p.agrupar_por?.length) {
    const r = await (d as unknown as { aggregate: (a: unknown) => Promise<Record<string, Record<string, unknown>>> }).aggregate({
      where, _count: { _all: true }, ...(p.somar ? { _sum: { [p.somar]: true }, _avg: { [p.somar]: true } } : {}),
    });
    return { modelo: p.modelo, quantidade: r._count?._all, soma: p.somar ? r._sum?.[p.somar] : undefined, media: p.somar ? r._avg?.[p.somar] : undefined };
  }
  const grupos = await d.groupBy({
    by: p.agrupar_por, where, _count: { _all: true }, ...(p.somar ? { _sum: { [p.somar]: true } } : {}),
    orderBy: { _count: { [p.agrupar_por[0]]: "desc" } }, take: LIMITE_MAX,
  });
  return {
    modelo: p.modelo,
    grupos: grupos.map((g) => ({
      ...Object.fromEntries(p.agrupar_por!.map((k) => [k, g[k]])),
      quantidade: (g._count as { _all: number })._all,
      ...(p.somar ? { soma: (g._sum as Record<string, unknown>)[p.somar] } : {}),
    })),
  };
}
