import { prisma } from "@/lib/prisma";
import { comChaveAvanteza, corpoJson } from "@/lib/integracao/avanteza";
import { definirModeloPadrao } from "@/lib/entrega/modelo";

/** { padrao: true } faz deste o modelo aplicado ao ganhar; { ativo: false } o desativa. */
export const PATCH = (req: Request, ctx: { params: Promise<{ modeloId: string }> }) => comChaveAvanteza(req, async () => {
  const { modeloId } = await ctx.params;
  const c = await corpoJson(req);
  if (!(await prisma.modeloEntrega.findUnique({ where: { id: modeloId }, select: { id: true } }))) return Response.json({ erro: "Modelo não encontrado" }, { status: 404 });
  if (c.padrao === true) await definirModeloPadrao(modeloId);
  else if (c.ativo === false) await prisma.modeloEntrega.update({ where: { id: modeloId }, data: { ativo: false, padrao: false } });
  return Response.json({ ok: true });
});
