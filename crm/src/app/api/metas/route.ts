import { prisma } from "@/lib/prisma";
import { definirMeta, metasDoAno, TIPOS_META, type TipoMeta } from "@/lib/relatorios/consultas";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada, ErroEntrada, escolha } from "@/lib/validar";

export const dynamic = "force-dynamic";

const inteiro = (v: unknown, campo: string, min: number, max: number) => {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !Number.isInteger(n) || n < min || n > max) throw new ErroEntrada(`${campo} inválido`);
  return n;
};

async function escopoValido(v: unknown): Promise<string> {
  if (v === undefined || v === null || v === "" || v === "TODOS") return "TODOS";
  const id = String(v);
  if (!(await prisma.funil.findUnique({ where: { id }, select: { id: true } }))) throw new ErroEntrada("Funil não encontrado");
  return id;
}

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  return comEntrada(async () => {
    const u = new URL(req.url).searchParams;
    const ano = inteiro(u.get("ano") ?? new Date().getUTCFullYear(), "ano", 2000, 2100);
    const tipo = escolha<TipoMeta>(u.get("tipo") ?? undefined, "tipo", TIPOS_META, "TOTAL");
    return Response.json({ ano, tipo, meses: await metasDoAno(ano, await escopoValido(u.get("escopo")), tipo) });
  });
}

/** Define a meta de um mês. valor 0 remove (= sem meta). */
export async function PUT(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const valor = Number(c.valor);
    if (c.valor === "" || c.valor === null || !Number.isFinite(valor) || valor < 0 || valor > 1e12) throw new ErroEntrada("valor inválido");
    await definirMeta({ escopo: await escopoValido(c.escopo), ano: inteiro(c.ano, "ano", 2000, 2100), mes: inteiro(c.mes, "mes", 1, 12), tipo: escolha<TipoMeta>(c.tipo, "tipo", TIPOS_META, "TOTAL"), valor });
    return Response.json({ ok: true });
  });
}
