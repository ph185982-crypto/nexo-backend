import { prisma } from "@/lib/prisma/client";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const linhas = await prisma.comHistoricoEtapa.findMany({
    where: { oportunidadeId: id }, orderBy: [{ entrouEm: "desc" }, { id: "desc" }], take: 50,
    select: { id: true, paraFunilNome: true, paraEtapaNome: true, paraTipo: true, entrouEm: true, saiuEm: true, origem: true, ator: true, motivo: true },
  });
  return Response.json({ historico: linhas });
}
