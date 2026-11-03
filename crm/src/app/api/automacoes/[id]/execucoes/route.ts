import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const execucoes = await prisma.automacaoExecucao.findMany({ where: { automacaoId: (await ctx.params).id }, orderBy: { criadoEm: "desc" }, take: 50 });
  const ids = [...new Set(execucoes.map((e) => e.oportunidadeId).filter((x): x is string => !!x))];
  const ops = await prisma.oportunidade.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } });
  return Response.json({ execucoes: execucoes.map((e) => ({ ...e, oportunidade: ops.find((o) => o.id === e.oportunidadeId)?.nome ?? null })) });
}
