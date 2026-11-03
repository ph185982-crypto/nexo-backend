import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/auth/admin";
import { definirModeloPadrao } from "@/lib/entrega/modelo";

/** { padrao: true } faz deste o modelo aplicado ao ganhar (os outros deixam de ser). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as { padrao?: unknown; ativo?: unknown } | null;
  if (!(await prisma.modeloEntrega.findUnique({ where: { id }, select: { id: true } }))) return Response.json({ erro: "Modelo não encontrado" }, { status: 404 });
  if (c?.padrao === true) await definirModeloPadrao(id);
  else if (c?.ativo === false) await prisma.modeloEntrega.update({ where: { id }, data: { ativo: false, padrao: false } });
  return Response.json({ ok: true });
}
