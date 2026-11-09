import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada } from "@/lib/validar";
import { detalheOportunidade, editarOportunidade, validarEdicaoOportunidade } from "@/lib/oportunidades/edicao";
import { linhasDaOportunidade } from "@/lib/oportunidades/produtos";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const d = await detalheOportunidade(id);
  if (!d) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
  return Response.json({ ...d, produtos: await linhasDaOportunidade(id) });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const u = await prisma.usuario.findUnique({ where: { id: uid }, select: { nome: true } });
    const r = await editarOportunidade(id, validarEdicaoOportunidade(c), { id: uid, nome: u?.nome ?? null });
    if (!r) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
    return Response.json(r);
  });
}
