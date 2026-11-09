import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada } from "@/lib/validar";
import { adicionarLinha, linhasDaOportunidade, validarLinha } from "@/lib/oportunidades/produtos";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  return Response.json({ produtos: await linhasDaOportunidade(id) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    if (!(await prisma.oportunidade.findUnique({ where: { id }, select: { id: true } }))) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
    const l = await adicionarLinha(id, await validarLinha(c));
    return Response.json({ id: l.id }, { status: 201 });
  });
}
