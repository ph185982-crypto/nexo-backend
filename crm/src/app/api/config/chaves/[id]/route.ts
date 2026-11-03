import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/auth/admin";

/** Revoga (a chave para de valer na hora; o registro fica para auditoria). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const r = await prisma.chaveIntegracao.updateMany({ where: { id: (await ctx.params).id, revogadaEm: null }, data: { revogadaEm: new Date() } });
  return r.count ? Response.json({ ok: true }) : Response.json({ erro: "Chave não encontrada ou já revogada" }, { status: 404 });
}
