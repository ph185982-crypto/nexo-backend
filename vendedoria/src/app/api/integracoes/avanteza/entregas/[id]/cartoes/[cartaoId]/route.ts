import { prisma } from "@/lib/prisma/client";
import { comChaveAvanteza, corpoJson } from "@/lib/comercial/integracao/avanteza";
import { atualizarCartao } from "@/lib/comercial/entrega/edicao";
import { detalheCartao } from "@/lib/comercial/entrega/quadro";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; cartaoId: string }> };

/** Abre o cartão com histórico. */
export const GET = (req: Request, ctx: Ctx) => comChaveAvanteza(req, async () => {
  const { id, cartaoId } = await ctx.params;
  const c = await detalheCartao(id, cartaoId);
  return c ? Response.json(c) : Response.json({ erro: "Cartão não encontrado" }, { status: 404 });
});

/** Move e/ou edita: coluna (+ posicao), titulo, descricao, pilar, dataAlvo, cliente, responsavelId, checklist. */
export const PATCH = (req: Request, ctx: Ctx) => comChaveAvanteza(req, async () => {
  const { id, cartaoId } = await ctx.params;
  return (await atualizarCartao(id, cartaoId, await corpoJson(req))) ? Response.json({ ok: true }) : Response.json({ erro: "Cartão não encontrado" }, { status: 404 });
});

export const DELETE = (req: Request, ctx: Ctx) => comChaveAvanteza(req, async () => {
  const { id, cartaoId } = await ctx.params;
  const r = await prisma.comEntregaCartao.deleteMany({ where: { id: cartaoId, entregaId: id } });
  return r.count ? Response.json({ ok: true }) : Response.json({ erro: "Cartão não encontrado" }, { status: 404 });
});
