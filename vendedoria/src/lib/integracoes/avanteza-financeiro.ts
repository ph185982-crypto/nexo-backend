// API de serviço do financeiro para a Central Avanteza.
//   /api/integracoes/avanteza/financeiro/<recurso>?escopo=empresa|pessoal
// Autenticação própria: Authorization: Bearer <AVANTEZA_FINANCE_KEY> (503 sem a variável, 401 com chave errada,
// comparação em tempo constante). A rota NÃO tem regra de negócio própria: valida a entrada com zod e executa as
// mesmas rotas /api/financeiro/* que a tela do Vendedor IA usa (dentro de `emServico`), que por sua vez chamam as
// funções de src/lib/finance — o Max, a tela antiga e a Central produzem resultados idênticos.
//
// Privacidade: nada aqui escreve log (nem de valores nem de descrições). Escopo: "empresa" = tipo_negocio "nexo";
// "pessoal" = "pessoal" (e, em receitas previstas, vazio). Toda chamada declara o escopo; ids de outro escopo = 404.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma/client";
import { conferirChave } from "@/lib/integracoes/avanteza-metricas";
import { emServico } from "@/lib/finance/servico";

export const ESCOPOS = ["empresa", "pessoal"] as const;
export type EscopoServico = (typeof ESCOPOS)[number];
export const TIPO_DO_ESCOPO: Record<EscopoServico, "nexo" | "pessoal"> = { empresa: "nexo", pessoal: "pessoal" };

/** Compara o Bearer com AVANTEZA_FINANCE_KEY (mesma função da rota de métricas). */
export const conferirChaveFinanceiro = (authorization: string | null | undefined, env: NodeJS.ProcessEnv = process.env) =>
  conferirChave(authorization, env.AVANTEZA_FINANCE_KEY);

// ─── Schemas (zod) ───────────────────────────────────────────────────────────
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD");
const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "use AAAA-MM");
const valor = z.number().finite().positive().max(1_000_000_000);
const texto = (max: number) => z.string().trim().min(1).max(max);
const negocio = z.enum(["nexo", "pessoal"]);
const inteiroTexto = z.string().regex(/^\d{1,6}$/);
const escopoQ = z.enum(ESCOPOS);
const periodoQ = { mes: mes.optional(), dia: data.optional(), de: data.optional(), ate: data.optional() };

const qTransacoes = z.object({
  escopo: escopoQ, tipo: z.enum(["receita", "despesa"]).optional(), categoria: texto(80).optional(), texto: texto(120).optional(),
  data_inicio: data.optional(), data_fim: data.optional(), page: inteiroTexto.optional(), pageSize: inteiroTexto.optional(),
  confirmado: z.enum(["true", "false"]).optional(),
}).strict();
const bTransacaoNova = z.object({
  tipo: z.enum(["receita", "despesa"]), valor, descricao: texto(300), categoria: texto(80), data_transacao: data.optional(), empresa: texto(120).optional(),
}).strict();
const bTransacaoEdicao = z.object({
  tipo: z.enum(["receita", "despesa"]), valor, descricao: texto(300), categoria: texto(80), data_transacao: data,
  empresa: texto(120).nullable(), confirmado: z.boolean(), tipo_negocio: negocio, // tipo_negocio = reclassificar Empresa × Pessoal
}).partial().strict().refine((b) => Object.keys(b).length > 0, "nada para alterar");

const qContas = z.object({ escopo: escopoQ, status: z.enum(["pendente", "paga", "cancelada"]).optional() }).strict();
const bContaNova = z.object({
  descricao: texto(200), valor, data_vencimento: data, categoria: texto(80).optional(),
  recorrente: z.boolean().optional(), frequencia: z.enum(["mensal", "semanal", "anual"]).optional(),
}).strict();
const bContaAcao = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("pagar") }).strict(),
  z.object({ acao: z.literal("cancelar") }).strict(),
  z.object({
    acao: z.literal("editar"), descricao: texto(200).optional(), valor: valor.optional(), data_vencimento: data.optional(),
    categoria: texto(80).optional(), tipo_negocio: negocio.optional(),
  }).strict(),
]);

const qReceitas = z.object({
  escopo: escopoQ, ...periodoQ, contrato_id: z.string().max(64).optional(),
  status: z.enum(["abertas", "atrasada", "pendente", "recebida", "perdida"]).optional(),
}).strict();
const baseReceita = { descricao: texto(200), data_prevista: data, cliente: texto(120).optional(), observacao: texto(500).optional() };
const bReceitaNova = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("avulsa"), ...baseReceita, valor }).strict(),
  z.object({
    modo: z.literal("parcelada"), ...baseReceita, meses: z.number().int().min(1).max(120),
    valor_total: valor.optional(), valor_parcela: valor.optional(), dia_vencimento: z.number().int().min(1).max(31).optional(),
  }).strict(),
  z.object({
    modo: z.literal("recorrente"), ...baseReceita, meses: z.number().int().min(1).max(120).nullable().optional(),
    valor_parcela: valor, dia_vencimento: z.number().int().min(1).max(31).optional(),
  }).strict(),
]).refine((b) => b.modo !== "parcelada" || Boolean(b.valor_total || b.valor_parcela), "informe valor_total ou valor_parcela");
const bReceitaAcao = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("confirmar") }).strict(),
  z.object({ acao: z.literal("perder"), motivo: texto(300).optional() }).strict(),
  z.object({ acao: z.literal("reverter_perda") }).strict(),
  z.object({
    acao: z.literal("editar"), valor: valor.optional(), descricao: texto(200).optional(), cliente: texto(120).nullable().optional(),
    observacao: texto(500).nullable().optional(), data_prevista: data.optional(), tipo_negocio: negocio.optional(),
  }).strict(),
]);

const bContratoAcao = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("encerrar"), motivo: texto(300).optional() }).strict(),
  z.object({
    acao: z.literal("editar"), valor_parcela: valor.optional(), valor_total: valor.optional(), descricao: texto(200).optional(),
    cliente: texto(120).nullable().optional(), observacao: texto(500).nullable().optional(), a_partir_de: data.optional(),
  }).strict(),
]);

const qPeriodo = z.object({ escopo: escopoQ, ...periodoQ }).strict();
const soEscopo = z.object({ escopo: escopoQ }).strict();
const bAporte = z.object({ meta_id: z.string().min(1).max(64), valor: z.number().finite().refine((v) => v !== 0).refine((v) => Math.abs(v) <= 1_000_000_000), data: data.optional(), observacao: texto(300).optional() }).strict();
const bMetaEdicao = z.object({
  aporte_diario: z.number().min(0).max(1_000_000), valor_alvo: valor, data_fim: data, cobrar_diariamente: z.boolean(),
  descricao: texto(200), status: z.enum(["ativa", "encerrada"]),
}).partial().strict().refine((b) => Object.keys(b).length > 0, "nada para alterar");

// ─── Tabela de rotas ─────────────────────────────────────────────────────────
type Metodo = "GET" | "POST" | "PATCH" | "DELETE";
type Handler = (req: NextRequest, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
type Modulo = Partial<Record<Metodo, Handler>>;
export type Entidade = "transacao" | "conta" | "receita" | "contrato";

const MODULOS = {
  transacoes: () => import("@/app/api/financeiro/transacoes/route") as Promise<Modulo>,
  transacao: () => import("@/app/api/financeiro/transacoes/[id]/route") as Promise<Modulo>,
  contas: () => import("@/app/api/financeiro/contas/route") as Promise<Modulo>,
  conta: () => import("@/app/api/financeiro/contas/[id]/route") as Promise<Modulo>,
  receitas: () => import("@/app/api/financeiro/receitas/route") as Promise<Modulo>,
  receita: () => import("@/app/api/financeiro/receitas/[id]/route") as Promise<Modulo>,
  contratos: () => import("@/app/api/financeiro/contratos/route") as Promise<Modulo>,
  contrato: () => import("@/app/api/financeiro/contratos/[id]/route") as Promise<Modulo>,
  metas: () => import("@/app/api/financeiro/metas-poupanca/route") as Promise<Modulo>,
  meta: () => import("@/app/api/financeiro/metas-poupanca/[id]/route") as Promise<Modulo>,
  overview: () => import("@/app/api/financeiro/overview/route") as Promise<Modulo>,
  dre: () => import("@/app/api/financeiro/dre/route") as Promise<Modulo>,
} as const;

interface RotaDef {
  metodo: Metodo;
  caminho: string; // relativo à raiz da API; ":id" = parâmetro
  modulo: keyof typeof MODULOS | "categorias";
  query?: z.ZodType<Record<string, string | undefined>>;
  body?: z.ZodType<unknown>;
  entidade?: Entidade;
  /** POST: injeta tipo_negocio conforme o escopo (o cliente nunca escolhe). */
  injetaNegocio?: boolean;
  /** Só existe no escopo pessoal (metas de poupança). */
  soPessoal?: boolean;
  /** Corpo fixo enviado ao handler interno (ex.: confirmar lançamento). */
  corpoFixo?: Record<string, unknown>;
  /** Transforma o id em parâmetro de query do handler interno (DELETE de aporte). */
  idComoQuery?: string;
  metodoInterno?: Metodo;
}

export const ROTAS: RotaDef[] = [
  { metodo: "GET", caminho: "transacoes", modulo: "transacoes", query: qTransacoes },
  { metodo: "POST", caminho: "transacoes", modulo: "transacoes", query: soEscopo, body: bTransacaoNova, injetaNegocio: true },
  { metodo: "PATCH", caminho: "transacoes/:id", modulo: "transacao", query: soEscopo, body: bTransacaoEdicao, entidade: "transacao" },
  { metodo: "DELETE", caminho: "transacoes/:id", modulo: "transacao", query: soEscopo, entidade: "transacao" },
  { metodo: "POST", caminho: "transacoes/:id/confirmar", modulo: "transacao", query: soEscopo, entidade: "transacao", metodoInterno: "PATCH", corpoFixo: { confirmado: true } },
  { metodo: "GET", caminho: "contas", modulo: "contas", query: qContas },
  { metodo: "POST", caminho: "contas", modulo: "contas", query: soEscopo, body: bContaNova, injetaNegocio: true },
  { metodo: "PATCH", caminho: "contas/:id", modulo: "conta", query: soEscopo, body: bContaAcao, entidade: "conta" },
  { metodo: "DELETE", caminho: "contas/:id", modulo: "conta", query: soEscopo, entidade: "conta" },
  { metodo: "GET", caminho: "receitas", modulo: "receitas", query: qReceitas },
  { metodo: "POST", caminho: "receitas", modulo: "receitas", query: soEscopo, body: bReceitaNova, injetaNegocio: true },
  { metodo: "PATCH", caminho: "receitas/:id", modulo: "receita", query: soEscopo, body: bReceitaAcao, entidade: "receita" },
  { metodo: "GET", caminho: "contratos", modulo: "contratos", query: soEscopo },
  { metodo: "PATCH", caminho: "contratos/:id", modulo: "contrato", query: soEscopo, body: bContratoAcao, entidade: "contrato" },
  { metodo: "GET", caminho: "metas", modulo: "metas", query: soEscopo, soPessoal: true },
  { metodo: "POST", caminho: "metas/aportes", modulo: "metas", query: soEscopo, body: bAporte, soPessoal: true },
  { metodo: "PATCH", caminho: "metas/:id", modulo: "meta", query: soEscopo, body: bMetaEdicao, soPessoal: true },
  { metodo: "DELETE", caminho: "metas/aportes/:id", modulo: "metas", query: soEscopo, soPessoal: true, idComoQuery: "aporte_id" },
  { metodo: "GET", caminho: "resumo", modulo: "overview", query: qPeriodo },
  { metodo: "GET", caminho: "dre", modulo: "dre", query: qPeriodo },
  { metodo: "GET", caminho: "categorias", modulo: "categorias", query: soEscopo },
];

const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function casarRota(metodo: string, segmentos: string[]): { rota?: RotaDef; id?: string; metodoNaoPermitido?: boolean } {
  let existe = false;
  for (const r of ROTAS) {
    const partes = r.caminho.split("/");
    if (partes.length !== segmentos.length) continue;
    let id: string | undefined;
    let ok = true;
    for (let i = 0; i < partes.length; i++) {
      if (partes[i] === ":id") { if (RE_ID.test(segmentos[i])) id = segmentos[i]; else ok = false; }
      else if (partes[i] !== segmentos[i]) ok = false;
    }
    if (!ok) continue;
    existe = true;
    if (r.metodo === metodo) return { rota: r, id };
  }
  return existe ? { metodoNaoPermitido: true } : {};
}

// ─── Execução ────────────────────────────────────────────────────────────────
const SEM_CACHE = { "Cache-Control": "no-store" };
const json = (corpo: unknown, status: number, extra: Record<string, string> = {}) =>
  NextResponse.json(corpo, { status, headers: { ...SEM_CACHE, ...extra } });

/** O registro existe e pertence ao escopo pedido? (receita sem tipo_negocio = pessoal) */
export async function registroNoEscopo(entidade: Entidade, id: string, escopo: EscopoServico): Promise<boolean> {
  const alvo = TIPO_DO_ESCOPO[escopo];
  let tipo: string | null | undefined;
  if (entidade === "transacao") tipo = (await prisma.transacao.findUnique({ where: { id }, select: { tipo_negocio: true } }))?.tipo_negocio;
  else if (entidade === "conta") tipo = (await prisma.contaPagarMax.findUnique({ where: { id }, select: { tipo_negocio: true } }))?.tipo_negocio;
  else if (entidade === "contrato") tipo = (await prisma.contratoReceita.findUnique({ where: { id }, select: { tipo_negocio: true } }))?.tipo_negocio;
  else {
    const r = await prisma.receitaPrevistaMax.findUnique({ where: { id }, select: { tipo_negocio: true } });
    if (!r) return false;
    tipo = r.tipo_negocio ?? "pessoal";
  }
  return tipo === alvo;
}

async function categorias(escopo: EscopoServico) {
  const tipo_negocio = TIPO_DO_ESCOPO[escopo];
  const [t, c] = await Promise.all([
    prisma.transacao.findMany({ where: { tipo_negocio }, distinct: ["tipo", "categoria"], select: { tipo: true, categoria: true } }),
    prisma.contaPagarMax.findMany({ where: { tipo_negocio }, distinct: ["categoria"], select: { categoria: true } }),
  ]);
  const ord = (xs: Iterable<string>) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return {
    escopo,
    receitas: ord(t.filter((x) => x.tipo === "receita").map((x) => x.categoria)),
    despesas: ord([...t.filter((x) => x.tipo === "despesa").map((x) => x.categoria), ...c.map((x) => x.categoria)]),
  };
}

export async function tratarFinanceiro(req: NextRequest, segmentos: string[], env: NodeJS.ProcessEnv = process.env): Promise<NextResponse> {
  const auth = conferirChaveFinanceiro(req.headers.get("authorization"), env);
  if (auth === "sem-chave-configurada") return json({ error: "integração não configurada" }, 503);
  if (auth !== "ok") return json({ error: "não autorizado" }, 401, { "WWW-Authenticate": 'Bearer realm="avanteza-financeiro"' });

  const m = casarRota(req.method, segmentos);
  if (m.metodoNaoPermitido) return json({ error: "método não permitido" }, 405);
  if (!m.rota) return json({ error: "recurso não encontrado" }, 404);
  const rota = m.rota;

  // Query: só os campos declarados (strict) e o escopo é obrigatório.
  const bruto: Record<string, string> = {};
  for (const [k, v] of req.nextUrl.searchParams) bruto[k] = v;
  const q = (rota.query ?? soEscopo).safeParse(bruto);
  if (!q.success) return json({ error: "parâmetros inválidos", campos: q.error.issues.map((i) => i.path.join(".") || "(raiz)") }, 400);
  const query = q.data as Record<string, string | undefined>;
  const escopo = query.escopo as EscopoServico;

  if (rota.soPessoal && escopo !== "pessoal") return json({ error: "recurso disponível só no escopo pessoal" }, 404);

  // Corpo
  let corpo: Record<string, unknown> | undefined;
  if (rota.body) {
    const texto = await req.text();
    let cru: unknown;
    try { cru = JSON.parse(texto); } catch { return json({ error: "JSON inválido" }, 400); }
    const b = rota.body.safeParse(cru);
    if (!b.success) return json({ error: "corpo inválido", campos: b.error.issues.map((i) => i.path.join(".") || "(raiz)") }, 400);
    corpo = b.data as Record<string, unknown>;
  }
  if (rota.injetaNegocio) corpo = { ...corpo, tipo_negocio: TIPO_DO_ESCOPO[escopo] };
  if (rota.corpoFixo) corpo = { ...rota.corpoFixo };

  try {
    if (rota.entidade && m.id && !(await registroNoEscopo(rota.entidade, m.id, escopo))) return json({ error: "não encontrado" }, 404);
    if (rota.modulo === "categorias") return json(await categorias(escopo), 200);

    // Handler interno: mesma rota que a tela do Vendedor IA usa. `escopo` vira nexo|pessoal.
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) sp.set(k, k === "escopo" ? TIPO_DO_ESCOPO[escopo] : v);
    if (rota.idComoQuery && m.id) sp.set(rota.idComoQuery, m.id);
    const metodo = rota.metodoInterno ?? rota.metodo;
    const interna = new NextRequest(`http://servico.interno/api/financeiro/${rota.modulo}?${sp}`, {
      method: metodo,
      headers: corpo !== undefined ? { "content-type": "application/json" } : {},
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    });
    const mod = await MODULOS[rota.modulo]();
    const handler = mod[metodo];
    if (!handler) return json({ error: "método não permitido" }, 405);
    const resp = await emServico(() => handler(interna, m.id && !rota.idComoQuery ? { params: Promise.resolve({ id: m.id! }) } : undefined));
    const texto = await resp.text();
    return new NextResponse(texto, { status: resp.status, headers: { "content-type": resp.headers.get("content-type") ?? "application/json", ...SEM_CACHE } });
  } catch {
    // Sem detalhes: o erro pode carregar valores/descrições.
    return json({ error: "falha ao processar" }, 500);
  }
}
