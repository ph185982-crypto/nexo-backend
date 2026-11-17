// Busca global da Central (Ctrl+K) no Comercial: oportunidades, contatos e contratos. Só leitura.
// Contrato: GET /api/integracoes/avanteza/busca?q=&limite=&tipos= (docs na rota). O texto chega normalizado pela
// Central (sem acento, minúsculo); aqui a comparação também ignora acento e caixa no banco (translate + lower, sem
// depender da extensão unaccent) e o termo é literal (%, _ e \ escapados). O detalhe nunca leva telefone, e-mail,
// documento nem valor de contrato: só etapa/valor da oportunidade, empresa/cargo do contato, status/data do contrato.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import { ErroEntrada } from "@/lib/comercial/validar";
import { linkOportunidade } from "@/lib/comercial/navegacao";

export const TIPOS_BUSCA = ["oportunidades", "contatos", "contratos"] as const;
export type TipoBusca = (typeof TIPOS_BUSCA)[number];
export interface ItemBusca { id: string; titulo: string; detalhe?: string; caminho: string }
export type ResultadoBuscaCentral = Partial<Record<TipoBusca, ItemBusca[]>>;

const COM_ACENTO = "áàâãäåéèêëíìîïóòôõöúùûüçñýÿ";
const SEM_ACENTO = "aaaaaaeeeeiiiiooooouuuucnyy";

/** Minúsculo e sem acento (o mesmo que o banco faz com translate(lower(...))). */
export function normalizarBusca(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Padrão LIKE literal: escapa \ % _ (ESCAPE '\'). */
export const padraoLiteral = (termo: string) => `%${termo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const corta = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const STATUS_CONTRATO: Record<string, string> = {
  GERADO: "Gerado", ENVIADO: "Enviado para assinatura", ASSINADO_PARCIAL: "Assinado em parte", ASSINADO: "Assinado",
  RECUSADO: "Recusado", CANCELADO: "Cancelado", ERRO: "Com erro",
};

/** Lê e valida os parâmetros (400 por ErroEntrada). */
export function lerParametros(url: URL): { q: string; limite: number; tipos: TipoBusca[] } {
  const q = normalizarBusca(url.searchParams.get("q") ?? "");
  if (q.length < 2 || q.length > 80) throw new ErroEntrada("q deve ter de 2 a 80 caracteres");
  const l = url.searchParams.get("limite");
  const limite = l === null || l === "" ? 5 : Number(l);
  if (!Number.isInteger(limite) || limite < 1 || limite > 10) throw new ErroEntrada("limite deve ser de 1 a 10");
  const t = url.searchParams.get("tipos");
  const tipos = t === null || t.trim() === "" ? [...TIPOS_BUSCA] : [...new Set(t.split(",").map((x) => x.trim()).filter(Boolean))];
  for (const x of tipos) if (!(TIPOS_BUSCA as readonly string[]).includes(x)) throw new ErroEntrada(`tipo inválido: ${x}`);
  return { q, limite, tipos: tipos as TipoBusca[] };
}

const semAcento = (coluna: Prisma.Sql) => Prisma.sql`translate(lower(${coluna}), ${COM_ACENTO}, ${SEM_ACENTO})`;

async function oportunidades(padrao: string, limite: number): Promise<ItemBusca[]> {
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT o.id FROM com_oportunidade o JOIN com_contato c ON c.id = o."contatoId"
    WHERE ${semAcento(Prisma.sql`o.nome`)} LIKE ${padrao} ESCAPE '\\' OR ${semAcento(Prisma.sql`c.nome`)} LIKE ${padrao} ESCAPE '\\'
    ORDER BY (o.status = 'EM_ANDAMENTO') DESC, o."atualizadoEm" DESC LIMIT ${limite}`;
  if (!ids.length) return [];
  const ops = await prisma.comOportunidade.findMany({
    where: { id: { in: ids.map((i) => i.id) } },
    select: { id: true, funilId: true, nome: true, status: true, valorUnico: true, valorMensal: true, contato: { select: { nome: true } }, etapa: { select: { nome: true } } },
  });
  const porId = new Map(ops.map((o) => [o.id, o]));
  return ids.flatMap(({ id }) => {
    const o = porId.get(id);
    if (!o) return [];
    const unico = Number(o.valorUnico), mensal = Number(o.valorMensal);
    const valor = [unico ? reais(unico) : "", mensal ? `${reais(mensal)}/mês` : ""].filter(Boolean).join(" + ");
    const etapa = o.status === "EM_ANDAMENTO" ? o.etapa.nome : o.status === "GANHA" ? "Ganha" : "Perdida";
    return [{ id: o.id, titulo: corta(o.nome), detalhe: corta([o.contato.nome, etapa, valor].filter(Boolean).join(" · ")), caminho: linkOportunidade(o) }];
  });
}

async function contatos(padrao: string, limite: number): Promise<ItemBusca[]> {
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM com_contato WHERE ${semAcento(Prisma.sql`nome`)} LIKE ${padrao} ESCAPE '\\'
    ORDER BY "atualizadoEm" DESC LIMIT ${limite}`;
  if (!ids.length) return [];
  const cs = await prisma.comContato.findMany({
    where: { id: { in: ids.map((i) => i.id) } },
    select: { id: true, nome: true, tipo: true, cargo: true, empresa: { select: { nome: true } } },
  });
  const porId = new Map(cs.map((c) => [c.id, c]));
  return ids.flatMap(({ id }) => {
    const c = porId.get(id);
    if (!c) return [];
    const detalhe = c.tipo === "EMPRESA" ? "Empresa" : [c.cargo, c.empresa?.nome].filter(Boolean).join(" · ") || "Pessoa";
    return [{ id: c.id, titulo: corta(c.nome), detalhe: corta(detalhe), caminho: `/comercial/contatos/${c.id}` }];
  });
}

async function contratos(padrao: string, limite: number): Promise<ItemBusca[]> {
  const linhas = await prisma.$queryRaw<Array<{ id: string; razaoSocial: string; nomeFantasia: string | null; status: string; criadoEm: Date; assinadoEm: Date | null }>>`
    SELECT id, "razaoSocial", "nomeFantasia", status, "criadoEm", "assinadoEm" FROM contrato_emitido
    WHERE ${semAcento(Prisma.sql`"razaoSocial"`)} LIKE ${padrao} ESCAPE '\\' OR ${semAcento(Prisma.sql`coalesce("nomeFantasia", '')`)} LIKE ${padrao} ESCAPE '\\'
    ORDER BY "criadoEm" DESC LIMIT ${limite}`;
  return linhas.map((c) => ({
    id: c.id,
    titulo: corta(c.nomeFantasia?.trim() || c.razaoSocial),
    detalhe: corta(`${STATUS_CONTRATO[c.status] ?? c.status} · ${c.assinadoEm ? `assinado em ${dia(c.assinadoEm)}` : `gerado em ${dia(c.criadoEm)}`}`),
    caminho: `/comercial/contratos?abrir=${encodeURIComponent(c.id)}`,
  }));
}

export async function buscarParaCentral(q: string, limite: number, tipos: TipoBusca[]): Promise<ResultadoBuscaCentral> {
  const padrao = padraoLiteral(normalizarBusca(q));
  const fn: Record<TipoBusca, (p: string, l: number) => Promise<ItemBusca[]>> = { oportunidades, contatos, contratos };
  const partes = await Promise.all(tipos.map(async (t) => [t, await fn[t](padrao, limite)] as const));
  return Object.fromEntries(partes);
}
