import { prisma } from "@/lib/prisma/client";
import { comChaveAvanteza, corpoJson } from "@/lib/comercial/integracao/avanteza";
import { definirModeloPadrao } from "@/lib/comercial/entrega/modelo";

/** { padrao: true } faz deste o modelo aplicado ao ganhar; { ativo: false } o desativa. */
export const PATCH = (req: Request, ctx: { params: Promise<{ modeloId: string }> }) => comChaveAvanteza(req, async () => {
  const { modeloId } = await ctx.params;
  const c = await corpoJson(req);
  if (!(await prisma.comModeloEntrega.findUnique({ where: { id: modeloId }, select: { id: true } }))) return Response.json({ erro: "Modelo não encontrado" }, { status: 404 });
  if (c.padrao === true) await definirModeloPadrao(modeloId);
  else if (c.ativo === false) await prisma.comModeloEntrega.update({ where: { id: modeloId }, data: { ativo: false, padrao: false } });
  return Response.json({ ok: true });
});
