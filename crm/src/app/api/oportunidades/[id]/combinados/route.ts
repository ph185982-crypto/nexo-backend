import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada } from "@/lib/validar";
import { validarCombinado } from "@/lib/combinados/modelo";
import { criarCombinadoManual, listarCombinados } from "@/lib/combinados/servico";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  if (!(await prisma.oportunidade.findUnique({ where: { id }, select: { id: true } }))) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
  return Response.json({ ...(await listarCombinados(id)), agenteLigado: Boolean(process.env.ANTHROPIC_API_KEY?.trim()) });
}

/** Combinado escrito à mão: já nasce aceito, com tarefa/cartão/compromisso. */
export async function POST(req: Request, ctx: Ctx) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const { id } = await ctx.params;
  const c = await req.json().catch(() => null);
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    if (!(await prisma.oportunidade.findUnique({ where: { id }, select: { id: true } }))) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
    return Response.json(await criarCombinadoManual(id, validarCombinado(c), uid), { status: 201 });
  });
}
