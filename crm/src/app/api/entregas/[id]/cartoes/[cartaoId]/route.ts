import { prisma } from "@/lib/prisma";
import { atualizarCartao } from "@/lib/entrega/edicao";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada } from "@/lib/validar";

type Ctx = { params: Promise<{ id: string; cartaoId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id, cartaoId } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => (await atualizarCartao(id, cartaoId, c)) ? Response.json({ ok: true }) : Response.json({ erro: "Cartão não encontrado" }, { status: 404 }));
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id, cartaoId } = await ctx.params;
  const r = await prisma.entregaCartao.deleteMany({ where: { id: cartaoId, entregaId: id } });
  return r.count ? Response.json({ ok: true }) : Response.json({ erro: "Cartão não encontrado" }, { status: 404 });
}
