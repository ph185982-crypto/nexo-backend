import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada, escolha } from "@/lib/validar";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as { status?: unknown } | null;
  return comEntrada(async () => {
    const status = escolha(c?.status, "status", ["AGENDADO", "REALIZADO", "CANCELADO"] as const);
    const r = await prisma.compromisso.updateMany({ where: { id }, data: { status } });
    return r.count ? Response.json({ ok: true }) : Response.json({ erro: "Compromisso não encontrado" }, { status: 404 });
  });
}
